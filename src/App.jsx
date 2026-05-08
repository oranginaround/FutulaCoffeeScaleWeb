import { useState, useRef, useEffect, useCallback } from 'react'

const SCALE_SERVICE = '0000fff0-0000-1000-8000-00805f9b34fb'
const CHAR_COMMAND = '0000fff1-0000-1000-8000-00805f9b34fb'
const CHAR_WEIGHT = '0000fff4-0000-1000-8000-00805f9b34fb'
const RESET_CMD = new Uint8Array([0xfd, 0x32, 0, 0, 0, 0, 0, 0, 0, 0, 0xcf])

const PRESET_WEIGHTS = [500, 350, 250]
const BLOOM_DURATION = 45000 // 45 seconds in ms
const TOTAL_BREW_TIME = 105000 // 1:45 in ms (total pouring time)
const FIFTHS_INTERVAL = 15000 // 15 seconds per pour in fifths mode
const FLOW_TOLERANCE = 2.5 // +/- ml/s window for ideal flow

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

// --- Chart Component ---
function WeightChart({ data, goalWeight, splitInFives }) {
  const containerRef = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setSize({ w: width, h: height })
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  if (!goalWeight || goalWeight <= 0) {
    return <div ref={containerRef} style={chartContainerStyle} />
  }

  // Coffee weight = target * 30/500, blooming = 2x coffee weight (from zero after tare)
  const coffeeWeight = goalWeight * 30 / 500
  const bloomingWeight = coffeeWeight * 2

  let guideLines = []
  if (splitInFives) {
    const step = goalWeight / 5
    for (let i = 1; i <= 5; i++) {
      const value = Math.round(step * i)
      const label = i === 1 ? `${value}g bloom` : `${value}g`
      guideLines.push({ value, label })
    }
  } else {
    guideLines.push({ value: Math.round(bloomingWeight), label: `${Math.round(bloomingWeight)}g bloom` })
    guideLines.push({ value: goalWeight, label: `${goalWeight}g` })
  }

  const maxWeight = goalWeight * 1.1
  const lastTime = data.length > 0 ? data[data.length - 1].time : 0
  const maxTime = lastTime > TOTAL_BREW_TIME ? lastTime : TOTAL_BREW_TIME
  const { w, h } = size
  const pad = { top: 10, bottom: 10, left: 10, right: 10 }
  const chartW = w - pad.left - pad.right
  const chartH = h - pad.top - pad.bottom

  // Build SVG path from data
  let pathD = ''
  if (data.length > 0 && chartW > 0 && chartH > 0) {
    data.forEach((point, i) => {
      const x = pad.left + (point.time / maxTime) * chartW
      const y = pad.top + chartH - (Math.max(0, point.weight) / maxWeight) * chartH
      if (i === 0) pathD += `M ${x} ${y}`
      else pathD += ` L ${x} ${y}`
    })
  }

  return (
    <div ref={containerRef} style={chartContainerStyle}>
      {w > 0 && h > 0 && (
        <svg width={w} height={h} style={{ display: 'block' }}>
          {/* Guide lines */}
          {guideLines.map((line, i) => {
            const y = pad.top + chartH - (line.value / maxWeight) * chartH
            return (
              <g key={i}>
                <line
                  x1={pad.left} y1={y} x2={w - pad.right} y2={y}
                  stroke="rgba(255,255,255,0.15)"
                  strokeWidth="1"
                  strokeDasharray="4,4"
                />
                <text
                  x={pad.left + 4} y={y - 4}
                  fill="rgba(255,255,255,0.35)"
                  fontSize="11"
                  fontFamily="system-ui, sans-serif"
                >
                  {line.label}
                </text>
              </g>
            )
          })}
          {/* Weight curve */}
          {pathD && (
            <path
              d={pathD}
              fill="none"
              stroke="rgba(74, 222, 128, 0.45)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {/* Vertical time markers */}
          {[
            { time: BLOOM_DURATION, label: '0:45' },
            { time: TOTAL_BREW_TIME, label: '1:45' },
          ].map((marker, i) => {
            const x = pad.left + (marker.time / maxTime) * chartW
            return (
              <g key={`vline-${i}`}>
                <line
                  x1={x} y1={pad.top} x2={x} y2={h - pad.bottom}
                  stroke="rgba(255,255,255,0.12)"
                  strokeWidth="1"
                  strokeDasharray="4,4"
                />
                <text
                  x={x - 3} y={h - pad.bottom - 4}
                  fill="rgba(255,255,255,0.3)"
                  fontSize="10"
                  fontFamily="system-ui, sans-serif"
                  textAnchor="end"
                >
                  {marker.label}
                </text>
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

const chartContainerStyle = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
}

// --- Modal Component ---
function TargetModal({ onClose, onApply, currentGoal, currentSplit }) {
  const [selected, setSelected] = useState(
    PRESET_WEIGHTS.includes(currentGoal) ? currentGoal : 'custom'
  )
  const [customValue, setCustomValue] = useState(
    PRESET_WEIGHTS.includes(currentGoal) ? '' : String(currentGoal || '')
  )
  const [splitInFives, setSplitInFives] = useState(currentSplit)

  function handleApply() {
    const value = selected === 'custom' ? parseInt(customValue, 10) : selected
    if (value && value > 0) {
      onApply(value, splitInFives)
    }
    onClose()
  }

  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.content} onClick={(e) => e.stopPropagation()}>
        <h2 style={modalStyles.title}>Target Weight</h2>

        <div style={modalStyles.options}>
          {PRESET_WEIGHTS.map((w) => (
            <button
              key={w}
              onClick={() => setSelected(w)}
              style={{
                ...modalStyles.option,
                background: selected === w ? '#22c55e' : '#333',
              }}
            >
              {w}g
            </button>
          ))}
          <button
            onClick={() => setSelected('custom')}
            style={{
              ...modalStyles.option,
              background: selected === 'custom' ? '#22c55e' : '#333',
            }}
          >
            Custom
          </button>
        </div>

        {selected === 'custom' && (
          <input
            type="number"
            placeholder="Enter weight in grams"
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            style={modalStyles.input}
            autoFocus
          />
        )}

        <label style={modalStyles.checkboxLabel}>
          <input
            type="checkbox"
            checked={splitInFives}
            onChange={(e) => setSplitInFives(e.target.checked)}
            style={modalStyles.checkbox}
          />
          Split in fives
        </label>

        <button onClick={handleApply} style={modalStyles.applyBtn}>
          Apply
        </button>
      </div>
    </div>
  )
}

const modalStyles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  content: {
    background: '#222',
    borderRadius: '16px',
    padding: '2rem',
    width: '90%',
    maxWidth: '360px',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.2rem',
  },
  title: {
    fontSize: '1.3rem',
    fontWeight: 600,
    margin: 0,
    color: '#fff',
  },
  options: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0.6rem',
  },
  option: {
    padding: '0.8rem',
    fontSize: '1rem',
    fontWeight: 600,
    border: 'none',
    borderRadius: '10px',
    color: '#fff',
    cursor: 'pointer',
  },
  input: {
    padding: '0.8rem',
    fontSize: '1rem',
    borderRadius: '10px',
    border: '1px solid #444',
    background: '#1a1a1a',
    color: '#fff',
    outline: 'none',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    fontSize: '1rem',
    color: '#ccc',
    cursor: 'pointer',
  },
  checkbox: {
    width: '1.2rem',
    height: '1.2rem',
    accentColor: '#22c55e',
  },
  applyBtn: {
    padding: '1rem',
    fontSize: '1.1rem',
    fontWeight: 600,
    border: 'none',
    borderRadius: '12px',
    background: '#22c55e',
    color: '#fff',
    cursor: 'pointer',
    marginTop: '0.5rem',
  },
}

// --- Main App ---
function App() {
  const [displayWeight, setDisplayWeight] = useState(0)
  const [connected, setConnected] = useState(false)
  const [status, setStatus] = useState('Disconnected')
  const [elapsed, setElapsed] = useState(0)
  const [running, setRunning] = useState(false)
  const [showTimerReset, setShowTimerReset] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [goalWeight, setGoalWeight] = useState(500)
  const [splitInFives, setSplitInFives] = useState(false)
  const [chartData, setChartData] = useState([])
  const [flowRate, setFlowRate] = useState(0)
  const commandChar = useRef(null)
  const timerStart = useRef(null)
  const timerInterval = useRef(null)
  const rawWeight = useRef(0)
  const tareOffset = useRef(0)
  const displayWeightRef = useRef(0)
  const runningRef = useRef(false)
  const wakeLock = useRef(null)

  // Keep screen awake while connected
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock.current = await navigator.wakeLock.request('screen')
        wakeLock.current.addEventListener('release', () => {
          wakeLock.current = null
        })
      }
    } catch (e) {
      // Wake lock request failed (e.g. low battery)
    }
  }

  function releaseWakeLock() {
    if (wakeLock.current) {
      wakeLock.current.release()
      wakeLock.current = null
    }
  }

  // Re-acquire wake lock when page becomes visible again
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible' && running) {
        requestWakeLock()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [running])

  // Keep runningRef in sync
  useEffect(() => {
    runningRef.current = running
  }, [running])

  const startTimer = useCallback(() => {
    if (running) return
    timerStart.current = Date.now() - elapsed
    timerInterval.current = setInterval(() => {
      const now = Date.now()
      const currentElapsed = now - timerStart.current
      setElapsed(currentElapsed)
      const currentW = displayWeightRef.current
      // Record chart data point
      setChartData((prev) => {
        const next = [...prev, { time: currentElapsed, weight: currentW }]
        // Calculate flow rate from last ~2 seconds of data
        if (next.length >= 2) {
          const windowStart = currentElapsed - 2000
          const recent = next.filter((p) => p.time >= windowStart)
          if (recent.length >= 2) {
            const first = recent[0]
            const last = recent[recent.length - 1]
            const dt = (last.time - first.time) / 1000
            if (dt > 0) {
              setFlowRate((last.weight - first.weight) / dt)
            }
          }
        }
        return next
      })
    }, 200)
    setRunning(true)
    setShowTimerReset(false)
    requestWakeLock()
  }, [running, elapsed])

  const stopTimer = useCallback(() => {
    if (!running) return
    clearInterval(timerInterval.current)
    setRunning(false)
    releaseWakeLock()
  }, [running])

  const resetTimer = useCallback(() => {
    clearInterval(timerInterval.current)
    setRunning(false)
    setElapsed(0)
    setShowTimerReset(false)
    setChartData([])
    setFlowRate(0)
    releaseWakeLock()
  }, [])

  useEffect(() => {
    return () => clearInterval(timerInterval.current)
  }, [])

  function handleTimerClick() {
    if (!running && elapsed > 0) {
      setShowTimerReset((prev) => !prev)
    }
  }

  async function connect() {
    try {
      setStatus('Selecting device...')
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ name: 'LFSmart Scale' }, { name: 'LEFU-CK811' }],
        optionalServices: [SCALE_SERVICE],
      })

      device.addEventListener('gattserverdisconnected', () => {
        setConnected(false)
        setStatus('Disconnected')
        commandChar.current = null
      })

      setStatus('Connecting...')
      const server = await device.gatt.connect()
      const service = await server.getPrimaryService(SCALE_SERVICE)

      commandChar.current = await service.getCharacteristic(CHAR_COMMAND)
      const weightChar = await service.getCharacteristic(CHAR_WEIGHT)

      await weightChar.startNotifications()
      weightChar.addEventListener('characteristicvaluechanged', (e) => {
        const v = new Uint8Array(e.target.value.buffer)
        const sign = v[5] > 0 ? -1 : 1
        const w = ((v[4] << 8) | v[3]) / 10 * sign
        rawWeight.current = w
        const adjusted = w - tareOffset.current
        displayWeightRef.current = adjusted
        setDisplayWeight(adjusted)
      })

      setConnected(true)
      setStatus('Connected')
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    }
  }

  async function tare() {
    // Software tare: immediately zero the display
    tareOffset.current = rawWeight.current
    setDisplayWeight(0)
    // Hardware tare: scale resets its own zero point
    if (commandChar.current) {
      await commandChar.current.writeValue(RESET_CMD)
      // After hardware tare, scale will report from zero,
      // so clear our software offset to avoid double subtraction
      tareOffset.current = 0
    }
  }

  function handleApplyGoal(value, split) {
    setGoalWeight(value)
    setSplitInFives(split)
    setChartData([])
  }

  function saveBrewImage() {
    const size = 500
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')

    // Background
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, 0, size, size)

    // Chart area
    const pad = { top: 40, bottom: 80, left: 50, right: 20 }
    const chartW = size - pad.left - pad.right
    const chartH = size - pad.top - pad.bottom
    const maxWeight = goalWeight * 1.1
    const lastTime = chartData.length > 0 ? chartData[chartData.length - 1].time : TOTAL_BREW_TIME
    const maxTime = lastTime > TOTAL_BREW_TIME ? lastTime : TOTAL_BREW_TIME

    // Horizontal guide lines
    const coffeeWeight = goalWeight * 30 / 500
    const bloomingWeight = coffeeWeight * 2
    let guideLines = []
    if (splitInFives) {
      const step = goalWeight / 5
      for (let i = 1; i <= 5; i++) {
        const value = Math.round(step * i)
        guideLines.push({ value, label: i === 1 ? `${value}g bloom` : `${value}g` })
      }
    } else {
      guideLines.push({ value: Math.round(bloomingWeight), label: `${Math.round(bloomingWeight)}g bloom` })
      guideLines.push({ value: goalWeight, label: `${goalWeight}g` })
    }

    ctx.setLineDash([4, 4])
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'
    ctx.lineWidth = 1
    ctx.font = '11px system-ui'
    ctx.fillStyle = 'rgba(255,255,255,0.4)'
    guideLines.forEach((line) => {
      const y = pad.top + chartH - (line.value / maxWeight) * chartH
      ctx.beginPath()
      ctx.moveTo(pad.left, y)
      ctx.lineTo(size - pad.right, y)
      ctx.stroke()
      ctx.fillText(line.label, pad.left + 4, y - 4)
    })

    // Vertical time markers
    const timeMarkers = [
      { time: BLOOM_DURATION, label: '0:45' },
      { time: TOTAL_BREW_TIME, label: '1:45' },
    ]
    timeMarkers.forEach((marker) => {
      const x = pad.left + (marker.time / maxTime) * chartW
      ctx.beginPath()
      ctx.moveTo(x, pad.top)
      ctx.lineTo(x, size - pad.bottom)
      ctx.stroke()
      ctx.textAlign = 'right'
      ctx.fillText(marker.label, x - 3, size - pad.bottom - 4)
      ctx.textAlign = 'left'
    })

    // Weight curve
    ctx.setLineDash([])
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.7)'
    ctx.lineWidth = 2.5
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    if (chartData.length > 0) {
      ctx.beginPath()
      chartData.forEach((point, i) => {
        const x = pad.left + (point.time / maxTime) * chartW
        const y = pad.top + chartH - (Math.max(0, point.weight) / maxWeight) * chartH
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
    }

    // Text info at bottom
    // Pour time: last time when weight was still changing
    let pourTime = 0
    for (let i = chartData.length - 1; i > 0; i--) {
      if (Math.abs(chartData[i].weight - chartData[i - 1].weight) > 0.3) {
        pourTime = Math.round(chartData[i].time / 1000)
        break
      }
    }
    const totalBrewTime = Math.round(elapsed / 1000)
    ctx.fillStyle = '#fff'
    ctx.font = '600 16px system-ui'
    ctx.fillText(`pour time: ${pourTime}s`, pad.left, size - 35)
    ctx.fillText(`total brew time: ${totalBrewTime}s`, pad.left, size - 12)

    // Download
    const link = document.createElement('a')
    link.download = `brew-${Date.now()}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  const showSave = !running && elapsed > 0 && displayWeight >= goalWeight

  return (
    <div style={styles.container}>
      {/* Connection status bar */}
      <div style={{
        ...styles.statusBar,
        background: connected ? '#22c55e' : '#333',
      }}>
        {connected ? (
          <span style={styles.statusBarText}>
            <i className="fa-solid fa-link" style={{ marginRight: '0.5em' }} />
            Connected
          </span>
        ) : (
          <button onClick={connect} style={styles.statusBarBtn}>
            <i className="fa-brands fa-bluetooth-b" style={{ marginRight: '0.5em' }} />
            Connect Scale
          </button>
        )}
      </div>

      {/* Scale section - 3/4 */}
      <div style={styles.scaleSection} onClick={() => connected && setShowModal(true)}>
        {/* Chart behind weight */}
        <WeightChart
          data={chartData}
          goalWeight={goalWeight}
          splitInFives={splitInFives}
        />
        <div style={styles.weightDisplay}>
          <span style={styles.weightValue}>{displayWeight.toFixed(1)}</span>
          <span style={styles.weightUnit}>g</span>
        </div>
        {/* Flow rate indicator - only after bloom and before reaching target */}
        {running && elapsed > BLOOM_DURATION && displayWeight < goalWeight && (() => {
          let idealFlow = 0

          if (splitInFives) {
            // Fifths mode: bloom is 1st fifth (0-45s), then pour each remaining 1/5 every 15s
            // Pours 2-5 happen at: 45s, 60s, 75s, 90s
            const pourPhase = Math.floor((elapsed - BLOOM_DURATION) / FIFTHS_INTERVAL)
            const pourTimeInPhase = ((elapsed - BLOOM_DURATION) % FIFTHS_INTERVAL) / 1000
            const step = goalWeight / 5
            if (pourPhase < 4 && pourTimeInPhase > 0) {
              // Each pour: deliver 1/5 of goal weight within 15 seconds
              idealFlow = step / (FIFTHS_INTERVAL / 1000)
            }
          } else {
            // Normal mode: pour everything from bloom weight to target in remaining time (45s to 1:45)
            const bloomWeight = chartData.find((p) => p.time >= BLOOM_DURATION)?.weight || 0
            const remainingWeight = goalWeight - bloomWeight
            const remainingTime = (TOTAL_BREW_TIME - BLOOM_DURATION) / 1000
            idealFlow = remainingTime > 0 ? remainingWeight / remainingTime : 0
          }

          const diff = flowRate - idealFlow
          let arrow = '●'
          let color = '#4ade80'
          if (idealFlow > 0 && flowRate < 0.1) {
            arrow = '▲'
            color = '#facc15'
          } else if (diff > FLOW_TOLERANCE) {
            arrow = '▼'
            color = '#facc15'
          } else if (diff < -FLOW_TOLERANCE) {
            arrow = '▲'
            color = '#facc15'
          }
          return (
            <div style={styles.flowRate}>
              <span style={{ color }}>{arrow}</span>
              {' '}{flowRate.toFixed(1)} ml/s
            </div>
          )
        })()}
      </div>

      {/* Timer section - 1/4 */}
      <div style={styles.timerSection} onClick={handleTimerClick}>
        <div style={{ textAlign: 'center' }}>
          <div style={styles.timerDisplay}>
            {formatTime(elapsed)}
          </div>
          {running && elapsed <= BLOOM_DURATION && (
            <div style={styles.phaseLabel}>bloom</div>
          )}
        </div>
        {showTimerReset && (
          <button onClick={(e) => { e.stopPropagation(); resetTimer() }} style={styles.timerResetBtn}>
            <i className="fa-solid fa-rotate-left" />
          </button>
        )}
      </div>

      {/* Bottom buttons */}
      <div style={styles.buttonBar}>
        <button
          onClick={tare}
          disabled={!connected}
          style={{ ...styles.btn, opacity: connected ? 1 : 0.4 }}
        >
          Tare
        </button>
        <button
          onClick={running ? stopTimer : startTimer}
          disabled={!connected}
          style={{ ...styles.btn, background: running ? '#ef4444' : '#22c55e', opacity: connected ? 1 : 0.4 }}
        >
          {running ? 'Stop' : 'Start'}
        </button>
      </div>

      {/* Save button */}
      {showSave && (
        <div style={styles.saveBar}>
          <button onClick={saveBrewImage} style={styles.saveBtn}>
            <i className="fa-solid fa-download" style={{ marginRight: '0.5em' }} />
            Save Brew
          </button>
        </div>
      )}

      {/* Target weight modal */}
      {showModal && (
        <TargetModal
          onClose={() => setShowModal(false)}
          onApply={handleApplyGoal}
          currentGoal={goalWeight}
          currentSplit={splitInFives}
        />
      )}
    </div>
  )
}

const styles = {
  container: {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    height: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    background: '#1a1a1a',
    color: '#fff',
    userSelect: 'none',
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.5rem',
    transition: 'background 0.3s',
  },
  statusBarText: {
    fontSize: '0.8rem',
    fontWeight: 600,
    color: '#fff',
  },
  statusBarBtn: {
    background: 'none',
    border: 'none',
    color: '#aaa',
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
    padding: '0.25rem 0.75rem',
  },
  scaleSection: {
    flex: 3,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    cursor: 'pointer',
    overflow: 'hidden',
  },
  weightDisplay: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'center',
    position: 'relative',
    zIndex: 1,
  },
  weightValue: {
    fontSize: 'clamp(4rem, 15vw, 10rem)',
    fontWeight: 200,
    fontVariantNumeric: 'tabular-nums',
  },
  weightUnit: {
    fontSize: 'clamp(1.2rem, 4vw, 2.5rem)',
    marginLeft: '0.3em',
    color: '#888',
  },
  flowRate: {
    fontSize: '0.9rem',
    color: '#888',
    marginTop: '0.5rem',
    position: 'relative',
    zIndex: 1,
  },
  phaseLabel: {
    fontSize: '0.85rem',
    color: '#666',
    marginTop: '0.25rem',
    letterSpacing: '0.05em',
  },
  timerSection: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderTop: '1px solid #333',
    position: 'relative',
    cursor: 'pointer',
  },
  timerDisplay: {
    fontSize: 'clamp(2rem, 8vw, 4rem)',
    fontWeight: 300,
    fontVariantNumeric: 'tabular-nums',
    color: '#e2e8f0',
  },
  timerResetBtn: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(26, 26, 26, 0.85)',
    border: 'none',
    color: '#fff',
    fontSize: 'clamp(2.5rem, 8vw, 4rem)',
    cursor: 'pointer',
  },
  buttonBar: {
    display: 'flex',
    gap: '1rem',
    padding: '1.5rem',
    justifyContent: 'center',
    borderTop: '1px solid #333',
  },
  btn: {
    flex: 1,
    maxWidth: '200px',
    padding: '1rem 2rem',
    fontSize: '1.1rem',
    fontWeight: 600,
    border: 'none',
    borderRadius: '12px',
    background: '#333',
    color: '#fff',
    cursor: 'pointer',
  },
  saveBar: {
    display: 'flex',
    justifyContent: 'center',
    padding: '0 1.5rem 1.5rem',
  },
  saveBtn: {
    padding: '0.75rem 2rem',
    fontSize: '1rem',
    fontWeight: 600,
    border: 'none',
    borderRadius: '12px',
    background: '#3b82f6',
    color: '#fff',
    cursor: 'pointer',
  },
}

export default App
