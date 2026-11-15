package dev.meuquerido.cellsignalmapper

import java.io.File
import java.io.IOException
import java.util.UUID

/** The install id's file name in `Context.getNoBackupFilesDir()`, which is never backed up. */
const val INSTALL_ID_FILE_NAME = "install_id"

/**
 * The install id stored in [file]. When [file] is missing or doesn't hold a UUID (a write torn by
 * a killed process), writes a new random UUID there first, through a temporary file and a rename
 * so a torn write never replaces a valid id. Throws [IOException] when the file can't be written.
 * Reads and writes a file: not for the main thread.
 */
fun installId(file: File): String {
    val stored = if (file.exists()) file.readText().trim() else ""
    if (isUuid(stored)) return stored
    val id = UUID.randomUUID().toString()
    replaceFile(file, id)
    return id
}

private fun isUuid(text: String): Boolean =
    try {
        UUID.fromString(text).toString() == text
    } catch (e: IllegalArgumentException) {
        false
    }
