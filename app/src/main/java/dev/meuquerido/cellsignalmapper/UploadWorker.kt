package dev.meuquerido.cellsignalmapper

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Whether an upload attempt is tried again later: when it failed and samples are still pending,
 * or when the pending count can't be read, so no sample is left waiting without a retry.
 */
fun retryUpload(uploaded: Boolean, pendingCount: Result<Int>): Boolean =
    !uploaded && pendingCount.fold(onSuccess = { it > 0 }, onFailure = { true })

/** Uploads the pending samples once a network is available, retrying with backoff until they go. */
class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val uploaded = FirebaseUploader.uploadLogFile(applicationContext)
        val pending = SignalLogger.countPending(
            SignalLogger.getLogFile(applicationContext),
            SignalLogger.getPendingFile(applicationContext),
        )
        return if (retryUpload(uploaded, pending)) Result.retry() else Result.success()
    }

    companion object {
        private const val WORK_NAME = "upload"

        /**
         * Schedules an upload as soon as a network is available. It replaces any upload already
         * scheduled, including one waiting out its backoff, so there is only ever one.
         */
        fun enqueue(context: Context) {
            val request = OneTimeWorkRequestBuilder<UploadWorker>()
                .setConstraints(
                    Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.REPLACE, request)
        }
    }
}
