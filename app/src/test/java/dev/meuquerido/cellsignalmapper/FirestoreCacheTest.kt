package dev.meuquerido.cellsignalmapper

import org.junit.Assert.assertEquals
import org.junit.Test

class FirestoreCacheTest {
    @Test
    fun onlyFirestoreDatabasesAreLeftovers() {
        val names = arrayOf(
            "firestore.%5BDEFAULT%5D.example-project.%28default%29",
            "firestore.%5BDEFAULT%5D.example-project.%28default%29-journal",
            "com.google.android.datatransport.events",
            "signal_log.json",
            "my_firestore.db",
        )
        assertEquals(
            listOf(
                "firestore.%5BDEFAULT%5D.example-project.%28default%29",
                "firestore.%5BDEFAULT%5D.example-project.%28default%29-journal",
            ),
            FirestoreCache.leftoverNames(names),
        )
    }
}
