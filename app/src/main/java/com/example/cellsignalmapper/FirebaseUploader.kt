package com.example.cellsignalmapper

import android.annotation.SuppressLint

import android.content.Context
import android.util.Log
import com.google.firebase.firestore.FirebaseFirestore
import com.google.gson.Gson
import java.io.File

object FirebaseUploader {
    @SuppressLint("StaticFieldLeak")
    private val db = FirebaseFirestore.getInstance()
    private val gson = Gson()

    fun uploadLogFile(context: Context, onComplete: (Boolean) -> Unit) {
        val file = SignalLogger.getLogFile(context)

        if (!file.exists()) {
            Log.d("FirebaseUploader", "No log file found.")
            onComplete(false)
            return
        }

        val lines = file.readLines()
        if (lines.isEmpty()) {
            Log.d("FirebaseUploader", "Log file is empty.")
            onComplete(false)
            return
        }

        val batch = db.batch()
        val collection = db.collection("signal_logs")

        lines.forEachIndexed { index, line ->
            try {
                val entry = gson.fromJson(line, SignalLogEntry::class.java)
                val doc = collection.document() // auto-ID
                batch.set(doc, entry)
            } catch (e: Exception) {
                Log.e("FirebaseUploader", "Failed to parse line $index", e)
            }
        }

        batch.commit().addOnSuccessListener {
            Log.d("FirebaseUploader", "Upload successful, deleting file.")
            file.delete()
            onComplete(true)
        }.addOnFailureListener {
            Log.e("FirebaseUploader", "Upload failed", it)
            onComplete(false)
        }
    }
}
