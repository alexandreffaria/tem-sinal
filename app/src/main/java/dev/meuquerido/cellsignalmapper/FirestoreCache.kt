package dev.meuquerido.cellsignalmapper

import android.content.Context

/**
 * Deletes the local cache the Firestore SDK left in the app's databases on phones that updated
 * from a version that wrote samples through it. It holds exact locations and times and nothing
 * reads it. The sample files and shared preferences are not databases, so this never touches them.
 */
object FirestoreCache {
    fun leftoverNames(databases: Array<String>): List<String> =
        databases.filter { it.startsWith("firestore.") }

    fun delete(context: Context) {
        leftoverNames(context.databaseList()).forEach(context::deleteDatabase)
    }
}
