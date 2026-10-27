package `in`.aeka.workspace

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context

/** The periodic sync (at least every 15 minutes, network required, kept across reboots) and retries. */
internal object Jobs {
    private const val PERIODIC = 4101
    private const val RETRY = 4102

    private fun scheduler(context: Context): JobScheduler? = context.getSystemService(JobScheduler::class.java)

    private fun builder(context: Context, id: Int) =
        JobInfo.Builder(id, ComponentName(context, SyncJobService::class.java))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true)

    fun schedulePeriodic(context: Context, seconds: Long) {
        val js = scheduler(context) ?: return
        val interval = seconds * 1000L
        val existing = js.getPendingJob(PERIODIC)
        if (existing != null && existing.isPeriodic && existing.intervalMillis == interval) return
        js.schedule(builder(context, PERIODIC).setPeriodic(interval).build())
    }

    fun scheduleRetry(context: Context, delayMs: Long) {
        val js = scheduler(context) ?: return
        js.schedule(builder(context, RETRY).setMinimumLatency(delayMs).build())
    }

    fun cancelRetry(context: Context) {
        scheduler(context)?.cancel(RETRY)
    }

    fun cancelAll(context: Context) {
        scheduler(context)?.let {
            it.cancel(PERIODIC)
            it.cancel(RETRY)
        }
    }
}

/** Runs a sync for the periodic and retry jobs. */
class SyncJobService : JobService() {
    override fun onStartJob(params: JobParameters): Boolean {
        if (!Store.get(this).paired) return false
        Syncer.get(this).syncAsync { jobFinished(params, false) }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean = true
}
