import { useState, useRef, useEffect, useCallback } from 'react'

const SCALE_SERVICE = '0000fff0-0000-1000-8000-00805f9b34fb'
const CHAR_COMMAND = '0000fff1-0000-1000-8000-00805f9b34fb'
const CHAR_WEIGHT = '0000fff4-0000-1000-8000-00805f9b34fb'
const RESET_CMD = new Uint8Array([0xfd, 0x32, 0, 0, 0, 0, 0, 0, 0, 0, 0xcf])

const PRESET_WEIGHTS = [500, 350, 250]

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function formatTimeShort(ms) {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0) return `${minutes}:${seconds.toString().padStart(2, '0')}`
  return `${seconds}s`
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
  const maxTime = data.length > 0 ? Math.max(data[data.length - 1].time, 30000) : 30000
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
  const commandChar = useRef(null)
  const timerStart = useRef(null)
  const timerInterval = useRef(null)
  const rawWeight = useRef(0)
  const tareOffset = useRef(0)
  const targetWeightRef = useRef(0)
  const currentWeightRef = useRef(0)
  const animFrame = useRef(null)
  const runningRef = useRef(false)

  // Keep runningRef in sync
  useEffect(() => {
    runningRef.current = running
  }, [running])

  useEffect(() => {
    let lastTime = performance.now()

    function animate(now) {
      const dt = (now - lastTime) / 1000
      lastTime = now
      const diff = targetWeightRef.current - currentWeightRef.current
      const speed = 12
      if (Math.abs(diff) < 0.05) {
        currentWeightRef.current = targetWeightRef.current
      } else {
        currentWeightRef.current += diff * Math.min(speed * dt, 1)
      }
      setDisplayWeight(currentWeightRef.current)
      animFrame.current = requestAnimationFrame(animate)
    }

    animFrame.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animFrame.current)
  }, [])

  const startTimer = useCallback(() => {
    if (running) return
    timerStart.current = Date.now() - elapsed
    timerInterval.current = setInterval(() => {
      const now = Date.now()
      const currentElapsed = now - timerStart.current
      setElapsed(currentElapsed)
      // Record chart data point
      setChartData((prev) => [
        ...prev,
        { time: currentElapsed, weight: currentWeightRef.current },
      ])
    }, 200)
    setRunning(true)
    setShowTimerReset(false)
  }, [running, elapsed])

  const stopTimer = useCallback(() => {
    if (!running) return
    clearInterval(timerInterval.current)
    setRunning(false)
  }, [running])

  const resetTimer = useCallback(() => {
    clearInterval(timerInterval.current)
    setRunning(false)
    setElapsed(0)
    setShowTimerReset(false)
    setChartData([])
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
        targetWeightRef.current = w - tareOffset.current
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
    targetWeightRef.current = 0
    currentWeightRef.current = 0
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
      <div style={styles.scaleSection} onClick={() => setShowModal(true)}>
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
      </div>

      {/* Timer section - 1/4 */}
      <div style={styles.timerSection} onClick={handleTimerClick}>
        <div style={styles.timerDisplay}>
          {formatTime(elapsed)}
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
          style={{ ...styles.btn, background: running ? '#ef4444' : '#22c55e' }}
        >
          {running ? 'Stop' : 'Start'}
        </button>
      </div>

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
}

export default App
