package dev.meuquerido.cellsignalmapper

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.lang.reflect.GenericArrayType
import java.lang.reflect.Modifier
import java.lang.reflect.ParameterizedType
import java.lang.reflect.Type
import java.lang.reflect.WildcardType

/**
 * R8 renames fields in the release build only, so a class Gson reads or writes without its own
 * keep rule in proguard-rules.pro breaks release builds while debug builds and other tests pass.
 * Gson's classes start at the sources' `fromJson` and `toJson` calls: every `fromJson` names its
 * class as `X::class.java`, and every `toJson` argument is either a constructor call of an app
 * class or an expression listed in [written] with the app classes it writes.
 */
class GsonKeepRulesTest {
    private val pkg = "dev.meuquerido.cellsignalmapper"

    // Unit tests run in the module's directory.
    private val sources = File("src/main/java/" + pkg.replace('.', '/'))
    private val rules = File("proguard-rules.pro")

    /**
     * What each `toJson` argument in the sources that isn't a constructor call writes, by file name
     * and argument text: the app classes in its static type. An argument missing here, or an entry
     * no call matches, fails the test.
     */
    private val written: Map<String, List<Class<*>>> = mapOf(
        "SignalLogger.kt: entry" to listOf(Sample::class.java),
        "Recordings.kt: change(readRecordings(file, gson))" to listOf(RecordingList::class.java),
        "FirebaseUploader.kt: sample" to listOf(Sample::class.java),
        "FirebaseUploader.kt: mapOf(\"samples\" to samples)" to listOf(Sample::class.java),
        "FirebaseUploader.kt: JsonParser.parseString(uploadBody(samples, gson))" to emptyList(),
        "FirebaseUploader.kt: it" to listOf(Sample::class.java),
        "FirebaseUploader.kt: mapOf(\"installId\" to installId)" to emptyList(),
        "FirebaseUploader.kt: mapOf(\"installId\" to installId, \"sessionId\" to sessionId)" to emptyList(),
    )

    /** "File.kt: arguments" for every `.[method](` call in the sources, whitespace collapsed. */
    private fun calls(method: String): List<String> =
        sources.walk().filter { it.extension == "kt" }.sortedBy { it.name }.flatMap { file ->
            val text = file.readText()
            Regex("""\.$method\(""").findAll(text).map { "${file.name}: " + arguments(text, it.range.last + 1) }
        }.toList()

    /** The text from [start] to the parenthesis that closes the one before it, skipping string literals. */
    private fun arguments(text: String, start: Int): String {
        var depth = 1
        var i = start
        var quoted = false
        while (depth > 0) {
            when {
                quoted && text[i] == '\\' -> i++
                text[i] == '"' -> quoted = !quoted
                !quoted && text[i] == '(' -> depth++
                !quoted && text[i] == ')' -> depth--
            }
            i++
        }
        return text.substring(start, i - 1).replace(Regex("""\s+"""), " ").trim()
    }

    private fun appClass(name: String): Class<*>? =
        try { Class.forName("$pkg.$name") } catch (e: ClassNotFoundException) { null }

    /** The classes named in the sources' `fromJson` calls; fails if a call names its class otherwise. */
    private fun readClasses(): Set<Class<*>> {
        val calls = calls("fromJson")
        val named = calls.mapNotNull { Regex("""\b(\w+)::class\.java$""").find(it)?.groupValues?.get(1) }
        assertEquals("every fromJson call names its class as X::class.java: $calls", calls.size, named.size)
        return named.map { Class.forName("$pkg.$it") }.toSet()
    }

    /** The app classes the sources' `toJson` calls write; fails on an argument it can't type. */
    private fun writtenClasses(): Set<Class<*>> {
        val calls = calls("toJson")
        val constructed = calls.associateWith { call ->
            Regex("""^\w+\.kt: (\w+)\(""").find(call)?.let { appClass(it.groupValues[1]) }
        }
        val unknown = calls.filter { constructed[it] == null && it !in written }
        assertEquals("toJson arguments to add to `written` with the app classes they write", emptyList<String>(), unknown)
        assertEquals("entries in `written` that no toJson call matches", emptyList<String>(), (written.keys - calls.toSet()).toList())
        return calls.flatMap { constructed[it]?.let(::listOf) ?: written.getValue(it) }.toSet()
    }

    /** The app's classes [type] refers to, through type arguments and arrays. */
    private fun appClasses(type: Type): List<Class<*>> = when (type) {
        is Class<*> -> if (type.isArray) appClasses(type.componentType!!) else listOfNotNull(type.takeIf { it.name.startsWith("$pkg.") })
        is ParameterizedType -> appClasses(type.rawType) + type.actualTypeArguments.flatMap { appClasses(it) }
        is WildcardType -> type.upperBounds.flatMap { appClasses(it) }
        is GenericArrayType -> appClasses(type.genericComponentType)
        else -> emptyList()
    }

    /** [roots] and every app class Gson reaches from them through the fields it serialises. */
    private fun reachable(roots: Set<Class<*>>): Set<Class<*>> {
        val seen = mutableSetOf<Class<*>>()
        val queue = ArrayDeque(roots)
        while (queue.isNotEmpty()) {
            val c = queue.removeFirst()
            if (!seen.add(c) || c.isEnum) continue
            c.declaredFields
                .filter { !Modifier.isStatic(it.modifiers) && !Modifier.isTransient(it.modifiers) && !it.isSynthetic }
                .forEach { queue.addAll(appClasses(it.genericType)) }
        }
        return seen
    }

    @Test
    fun everyGsonClassHasItsFieldsKept() {
        val expected = reachable(readClasses() + writtenClasses()).map { (if (it.isEnum) "enum " else "class ") + it.simpleName }.toSet()
        assertTrue("found no Gson calls in $sources", expected.isNotEmpty())
        val kept = rules.readLines()
            .mapNotNull { Regex("""^-keep (class|enum) ${Regex.escape(pkg)}\.(\w+) \{ <fields>; }$""").find(it.trim()) }
            .map { it.groupValues[1] + " " + it.groupValues[2] }
            .toSet()
        assertEquals("keep rules in $rules for the classes Gson reads and writes", expected.sorted(), kept.sorted())
    }
}
