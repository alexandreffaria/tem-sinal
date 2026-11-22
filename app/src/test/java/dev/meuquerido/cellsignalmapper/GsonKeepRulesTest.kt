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
 * Every class Gson reads is named in a `fromJson(…, X::class.java)` call in the app's sources, and
 * every class it writes is one of those or reachable from one, so those calls are where Gson's
 * classes start.
 */
class GsonKeepRulesTest {
    private val pkg = "dev.meuquerido.cellsignalmapper"

    // Unit tests run in the module's directory.
    private val sources = File("src/main/java/" + pkg.replace('.', '/'))
    private val rules = File("proguard-rules.pro")

    /** The classes named in the sources' `fromJson` calls; fails if a call names its class otherwise. */
    private fun readClasses(): Set<Class<*>> {
        val text = sources.walk().filter { it.extension == "kt" }.joinToString("\n") { it.readText() }
        val calls = Regex("""\.fromJson\(""").findAll(text).count()
        val names = Regex("""\.fromJson\([^()]*(?:\([^()]*\)[^()]*)*?\b(\w+)::class\.java\)""")
            .findAll(text).map { it.groupValues[1] }.toList()
        assertEquals("every fromJson call names its class as X::class.java", calls, names.size)
        return names.map { Class.forName("$pkg.$it") }.toSet()
    }

    /** The app's classes [type] refers to, through type arguments and arrays. */
    private fun appClasses(type: Type): List<Class<*>> = when (type) {
        is Class<*> -> if (type.isArray) appClasses(type.componentType) else listOfNotNull(type.takeIf { it.name.startsWith("$pkg.") })
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
        val expected = reachable(readClasses()).map { (if (it.isEnum) "enum " else "class ") + it.simpleName }.toSet()
        assertTrue("found no fromJson calls in $sources", expected.isNotEmpty())
        val kept = rules.readLines()
            .mapNotNull { Regex("""^-keep (class|enum) ${Regex.escape(pkg)}\.(\w+) \{ <fields>; }$""").find(it.trim()) }
            .map { it.groupValues[1] + " " + it.groupValues[2] }
            .toSet()
        assertEquals("keep rules in $rules for the classes Gson reads and writes", expected.sorted(), kept.sorted())
    }
}
