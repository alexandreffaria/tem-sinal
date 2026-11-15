package dev.meuquerido.cellsignalmapper

import java.io.File
import java.io.IOException

/**
 * Replaces [file] with [text] through a temporary file beside it, `<name>.tmp`, and a rename, so
 * a crash or a read mid-write sees either the earlier content or [text], never a mix. Throws
 * [IOException] when the write or the rename fails; [file] then keeps its earlier content.
 */
fun replaceFile(file: File, text: String) {
    val temporary = File(file.parentFile, "${file.name}.tmp")
    temporary.writeText(text)
    if (!temporary.renameTo(file)) throw IOException("Could not write ${file.name}")
}
