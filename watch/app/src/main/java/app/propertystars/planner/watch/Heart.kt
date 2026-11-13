// Heart.kt — heart rate from the watch's sensor while a workout or its rest is on screen (Health Services' measure
// client). One for the whole app, so it keeps measuring when the screen goes from a set to its rest and back: the
// recovery after a set is measured during that rest.
// It keeps three things (the sums are in HeartWindow.kt):
//   - since the last take(): added to the session's average and peak (the session's `hr`, as before)
//   - the set that's on: its average and peak, saved on the set when it's ticked
//   - the recovery after the last set ticked: how far heart rate fell, saved on that set a little later
package app.propertystars.planner.watch

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import androidx.health.services.client.HealthServices
import androidx.health.services.client.MeasureCallback
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataPointContainer
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.DeltaDataType

data class HeartSummary(val avg: Int, val max: Int, val samples: Int)

class Heart private constructor(context: Context) {
    private val app = context.applicationContext
    private val client = HealthServices.getClient(app).measureClient
    private val main = Handler(Looper.getMainLooper())
    private var sum = 0L
    private var count = 0
    private var peak = 0
    private var on = false
    private var users = 0
    private val set = SetWindow()
    private var recovery: RecoveryWindow? = null
    @Volatile private var latest = 0
    @Volatile private var latestAt = 0L

    private val callback = object : MeasureCallback {
        override fun onAvailabilityChanged(dataType: DeltaDataType<*, *>, availability: Availability) {}
        override fun onDataReceived(data: DataPointContainer) {
            val last = data.getData(DataType.HEART_RATE_BPM).lastOrNull() ?: return
            val bpm = last.value.toInt()
            if (bpm < 30 || bpm > 230) return
            val now = System.currentTimeMillis()
            synchronized(this@Heart) {
                sum += bpm; count++; if (bpm > peak) peak = bpm
                set.add(bpm)
                recovery?.add(bpm, now)
            }
            latest = bpm; latestAt = now
        }
    }

    // when the last screen lets go, the sensor stops a moment later (going from a set to its rest isn't a stop)
    private val stopLater = Runnable { if (users == 0) stop() }

    /** A screen that wants heart rate is showing. Pair every call with release(). */
    fun acquire() {
        users++
        main.removeCallbacks(stopLater)
        start()
    }

    fun release() {
        users = maxOf(0, users - 1)
        if (users == 0) main.postDelayed(stopLater, 3_000)
    }

    /** Is a workout or rest screen showing? */
    val inUse: Boolean get() = users > 0

    /** Start the sensor (again, after the permission was just given). Does nothing without the permission. */
    fun start() {
        if (on) return
        if (app.checkSelfPermission(Manifest.permission.BODY_SENSORS) != PackageManager.PERMISSION_GRANTED) return
        on = true
        try { client.registerMeasureCallback(DataType.HEART_RATE_BPM, callback) } catch (_: Exception) { on = false }
    }

    private fun stop() {
        if (!on) return
        on = false
        try { client.unregisterMeasureCallbackAsync(DataType.HEART_RATE_BPM, callback) } catch (_: Exception) { }
    }

    /** The last reading, or 0 when there's been none for 15 s. */
    fun bpmNow(nowMs: Long = System.currentTimeMillis()): Int = if (nowMs - latestAt < 15_000) latest else 0

    /** What was measured since the last call (it starts again from zero), to add to what the session already has. */
    @Synchronized
    fun take(): HeartSummary? {
        if (count == 0) return null
        val s = HeartSummary((sum / count).toInt(), peak, count)
        sum = 0; count = 0; peak = 0
        return s
    }

    /** This set is now the one to do (Step.id with the session key): its window starts, unless it's already on. */
    @Synchronized
    fun beginSet(id: String) = set.begin(id)

    /** The set whose window is open, or null. */
    @Synchronized
    fun openSet(): String? = set.id

    /** The set was ticked: its heart rate (null = no readings); the window closes until the next set starts. */
    @Synchronized
    fun endSet(): SetHeart? = set.end()

    /** Measure the recovery after a set just ticked, from its peak. Replaces one still going (finish that first). */
    @Synchronized
    fun startRecovery(target: SetRef, max: Int, doneAtMs: Long) {
        recovery = RecoveryWindow(target, max, doneAtMs)
    }

    /** The next set started (its rest ended, or it was ticked): the recovery as it stands, and it stops. */
    @Synchronized
    fun endRecovery(nowMs: Long = System.currentTimeMillis()): Recovered? {
        val r = recovery ?: return null
        recovery = null
        return r.result(nowMs)
    }

    /** 120 s after the tick: the recovery to write now (then it stops), else null. */
    @Synchronized
    fun recoveryDue(nowMs: Long = System.currentTimeMillis()): Recovered? {
        val r = recovery ?: return null
        if (!r.due(nowMs)) return null
        recovery = null
        return r.result(nowMs)
    }

    /** The set was un-done: forget its recovery. */
    @Synchronized
    fun cancelRecovery(key: String, ei: Int, si: Int) {
        val t = recovery?.target ?: return
        if (t.key == key && t.ei == ei && t.si == si) recovery = null
    }

    companion object {
        @Volatile private var one: Heart? = null
        fun get(context: Context): Heart = one ?: synchronized(this) { one ?: Heart(context).also { one = it } }
    }
}
