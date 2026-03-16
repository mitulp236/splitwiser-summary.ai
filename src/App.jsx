import { useState, useRef, useCallback, useEffect } from 'react'
import Header from './components/Header'
import Drawer from './components/Drawer'
import SettingsDialog from './components/SettingsDialog'
import PeopleDialog from './components/PeopleDialog'
import { analyzeImageWithGemini } from './lib/gemini'

// ─── Constants ───────────────────────────────────────────────────────────────

const ACCEPTED_IMAGE_TYPES = 'image/*,.heic,.heif'
const HEIC_TYPES = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']

const PERSON_COLORS = [
  { pill: 'bg-blue-50 text-blue-700 border-blue-200',     active: 'bg-blue-500 text-white border-blue-500',     avatar: 'bg-blue-500',     total: 'bg-blue-50 border-blue-200 text-blue-800' },
  { pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', active: 'bg-emerald-500 text-white border-emerald-500', avatar: 'bg-emerald-500', total: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
  { pill: 'bg-orange-50 text-orange-700 border-orange-200',  active: 'bg-orange-500 text-white border-orange-500',  avatar: 'bg-orange-500',  total: 'bg-orange-50 border-orange-200 text-orange-800' },
  { pill: 'bg-pink-50 text-pink-700 border-pink-200',       active: 'bg-pink-500 text-white border-pink-500',       avatar: 'bg-pink-500',    total: 'bg-pink-50 border-pink-200 text-pink-800' },
  { pill: 'bg-violet-50 text-violet-700 border-violet-200', active: 'bg-violet-500 text-white border-violet-500',   avatar: 'bg-violet-500',  total: 'bg-violet-50 border-violet-200 text-violet-800' },
  { pill: 'bg-amber-50 text-amber-700 border-amber-200',    active: 'bg-amber-500 text-white border-amber-500',    avatar: 'bg-amber-500',   total: 'bg-amber-50 border-amber-200 text-amber-800' },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(amount) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0)
}

function isHeicFile(file) {
  return HEIC_TYPES.includes(file.type?.toLowerCase()) || /\.(heic|heif)$/i.test(file.name)
}

async function getPreviewURL(file) {
  if (!isHeicFile(file)) return URL.createObjectURL(file)
  const heic2any = (await import('heic2any')).default
  const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 })
  return URL.createObjectURL(Array.isArray(blob) ? blob[0] : blob)
}

function extractJSON(text) {
  try { return JSON.parse(text) } catch {}
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (match) { try { return JSON.parse(match[1]) } catch {} }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end !== -1) { try { return JSON.parse(text.slice(start, end + 1)) } catch {} }
  throw new Error('Could not parse receipt data from AI response. Please try a clearer image.')
}

/**
 * Returns per-person breakdown:
 *   { [name]: { total, personalItems: [{name, price}], sharedItems: [{name, share, fullPrice}], taxTipShare } }
 */
function calcSplit(people, items, meta) {
  const result = {}
  people.forEach(p => { result[p] = { total: 0, personalItems: [], sharedItems: [], taxTipShare: 0 } })

  items.forEach(item => {
    const price = Number(item.price) || 0
    if (item.assignedTo === 'shared' && people.length > 0) {
      const share = price / people.length
      people.forEach(p => {
        result[p].total += share
        result[p].sharedItems.push({ name: item.name, share, fullPrice: price })
      })
    } else if (result[item.assignedTo]) {
      result[item.assignedTo].total += price
      result[item.assignedTo].personalItems.push({ name: item.name, price })
    }
  })

  const taxTip = (Number(meta.tax) || 0) + (Number(meta.tip) || 0)
  if (taxTip > 0 && people.length > 0) {
    const share = taxTip / people.length
    people.forEach(p => { result[p].total += share; result[p].taxTipShare = share })
  }

  return result
}

function generateFullText(people, split, meta, subtotal, tax, tip, total) {
  const taxTip = tax + tip
  const taxLabel = tax > 0 && tip > 0 ? 'Tax & Tip' : tax > 0 ? 'Tax' : 'Tip'
  const div = '═'.repeat(40)
  const thin = '─'.repeat(36)

  let t = `${div}\n 📊 SPLIT SUMMARY\n`
  if (meta.merchant !== 'Unknown') t += ` 📍 ${meta.merchant}\n`
  if (meta.date !== 'Unknown') t += ` 📅 ${meta.date}\n`
  t += ` 💰 Total: ${fmt(total)}\n${div}\n`

  people.forEach(person => {
    const data = split[person]
    t += `\n👤 ${person.toUpperCase()}  —  ${fmt(data.total)}\n`

    if (data.personalItems.length > 0) {
      t += `${thin}\n Personal items\n${thin}\n`
      data.personalItems.forEach(it => {
        const dots = '.'.repeat(Math.max(2, 32 - it.name.length))
        t += `  • ${it.name} ${dots} ${fmt(it.price)}\n`
      })
    }

    if (data.sharedItems.length > 0 || data.taxTipShare > 0) {
      t += `${thin}\n Shared (÷${people.length})\n${thin}\n`
      data.sharedItems.forEach(it => {
        const label = `${it.name} (${fmt(it.fullPrice)} ÷ ${people.length})`
        const dots = '.'.repeat(Math.max(2, 32 - label.length))
        t += `  • ${label} ${dots} ${fmt(it.share)}\n`
      })
      if (data.taxTipShare > 0) {
        const label = `${taxLabel} (${fmt(taxTip)} ÷ ${people.length})`
        const dots = '.'.repeat(Math.max(2, 32 - label.length))
        t += `  • ${label} ${dots} ${fmt(data.taxTipShare)}\n`
      }
    }

    t += `${'─'.repeat(29)} Total: ${fmt(data.total)}\n`
  })

  if (taxTip > 0) {
    t += `\n⚠️  TAX NOTE\n${thin}\n`
    t += ` ${taxLabel} of ${fmt(taxTip)} divided equally\n`
    t += ` among all ${people.length} people (${fmt(taxTip / people.length)} each).\n`
    t += ` Per-item tax rates are unknown — equal\n split used as best approximation.\n`
  }

  t += `\n${div}\n Generated by Splitwiser Summary AI\n${div}`
  return t
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ImageUploadZone({ onFileSelect, preview, isDragging, onDragOver, onDragLeave, onDrop, onClear }) {
  const fileInputRef = useRef(null)
  return (
    <div className="space-y-3">
      <label className="block text-sm font-semibold text-gray-700">
        Upload Receipt / Bill
        <span className="ml-2 text-xs font-normal text-gray-400">JPG, PNG, HEIC, WEBP & more</span>
      </label>
      {!preview ? (
        <div
          onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative flex flex-col items-center justify-center w-full min-h-48 rounded-2xl border-2 border-dashed cursor-pointer transition-all duration-200 group
            ${isDragging ? 'border-indigo-400 bg-indigo-50 scale-[1.01]' : 'border-gray-200 bg-gray-50 hover:border-indigo-300 hover:bg-indigo-50/50'}`}
        >
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl mb-3 transition-transform ${isDragging ? 'scale-110' : 'group-hover:scale-105'} bg-white shadow-sm`}>📷</div>
          <p className="text-sm font-semibold text-gray-700 mb-1">{isDragging ? 'Drop it here!' : 'Tap to select or drag & drop'}</p>
          <p className="text-xs text-gray-400">Works with iPhone HEIC photos too</p>
          <input ref={fileInputRef} type="file" accept={ACCEPTED_IMAGE_TYPES} className="hidden" onChange={e => onFileSelect(e.target.files?.[0])} />
        </div>
      ) : (
        <div className="relative rounded-2xl overflow-hidden bg-gray-900 shadow-md">
          <img src={preview} alt="Receipt" className="w-full max-h-72 object-contain" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          <button onClick={onClear} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 text-white text-sm flex items-center justify-center transition-colors">✕</button>
          <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
            <span className="text-white text-xs font-medium bg-black/40 px-3 py-1 rounded-full">Image ready</span>
            <button onClick={() => fileInputRef.current?.click()} className="text-white text-xs font-medium bg-indigo-500/80 hover:bg-indigo-500 px-3 py-1 rounded-full transition-colors">Change</button>
          </div>
          <input ref={fileInputRef} type="file" accept={ACCEPTED_IMAGE_TYPES} className="hidden" onChange={e => onFileSelect(e.target.files?.[0])} />
        </div>
      )}
    </div>
  )
}

function ItemRow({ item, index, people, onAssign, onUpdatePrice }) {
  const [isEditingPrice, setIsEditingPrice] = useState(false)
  const [priceValue, setPriceValue] = useState(String(item.price))

  const handlePriceSave = () => {
    const newPrice = parseFloat(priceValue) || 0
    if (newPrice !== item.price) {
      onUpdatePrice(index, newPrice)
    }
    setIsEditingPrice(false)
  }

  const handlePriceCancel = () => {
    setPriceValue(String(item.price))
    setIsEditingPrice(false)
  }

  const handlePriceKeyDown = (e) => {
    if (e.key === 'Enter') handlePriceSave()
    if (e.key === 'Escape') handlePriceCancel()
  }

  return (
    <div className="py-3.5 border-b border-gray-100 last:border-0">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-800 flex-1 mr-3">{item.name}</span>
        <div className="flex items-center gap-2">
          {!isEditingPrice ? (
            <>
              <span className="text-sm font-bold text-gray-900 tabular-nums cursor-pointer hover:text-indigo-600 transition-colors" onClick={() => setIsEditingPrice(true)}>
                {fmt(item.price)}
              </span>
              <button
                onClick={() => setIsEditingPrice(true)}
                className="text-xs text-gray-400 hover:text-indigo-500 px-2 py-1 rounded transition-colors"
                title="Edit price"
              >
                ✎
              </button>
            </>
          ) : (
            <div className="flex items-center gap-1.5">
              <div className="flex items-center bg-white border border-indigo-300 rounded-lg">
                <span className="text-xs text-gray-500 px-2 py-1">$</span>
                <input
                  type="number"
                  step="0.01"
                  value={priceValue}
                  onChange={(e) => setPriceValue(e.target.value)}
                  onKeyDown={handlePriceKeyDown}
                  className="w-16 px-1 py-1 text-sm font-medium appearance-none focus:outline-none bg-transparent"
                  autoFocus
                />
              </div>
              <button
                onClick={handlePriceSave}
                className="text-xs font-semibold text-green-600 hover:text-green-700 px-2 py-1 rounded transition-colors"
              >
                ✓
              </button>
              <button
                onClick={handlePriceCancel}
                className="text-xs font-semibold text-gray-400 hover:text-gray-600 px-2 py-1 rounded transition-colors"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => onAssign(index, 'shared')}
          className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
            item.assignedTo === 'shared' ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-gray-50 text-gray-500 border-gray-200 hover:border-indigo-300 hover:text-indigo-500'
          }`}>
          👥 Shared
        </button>
        {people.map((person, pi) => {
          const color = PERSON_COLORS[pi % PERSON_COLORS.length]
          return (
            <button key={person} onClick={() => onAssign(index, person)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                item.assignedTo === person ? color.active : color.pill + ' hover:opacity-80'
              }`}>
              {person}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SummaryCard({ people, split, meta, subtotal, tax, tip, total, onCopy, copied }) {
  const taxTip = tax + tip
  const taxLabel = tax > 0 && tip > 0 ? 'Tax & Tip' : tax > 0 ? 'Tax' : 'Tip'
  const fullText = generateFullText(people, split, meta, subtotal, tax, tip, total)

  return (
    <div id="summary-card" className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">

      {/* Header */}
      <div className="gradient-brand px-5 py-4 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">📊</span>
            <div>
              <p className="font-bold text-base">Split Summary</p>
              <p className="text-indigo-200 text-xs mt-0.5">
                {meta.merchant !== 'Unknown' ? meta.merchant : 'Receipt'}
                {meta.date !== 'Unknown' ? `  ·  ${meta.date}` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={() => onCopy(fullText)}
            className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-all flex-shrink-0 ${
              copied ? 'bg-green-400/30 text-green-100 border border-green-300/40' : 'bg-white/20 hover:bg-white/30 text-white border border-white/30'
            }`}
          >
            {copied ? '✅ Copied!' : '📋 Copy All'}
          </button>
        </div>
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-indigo-400/30">
          <p className="text-indigo-200 text-xs">Total bill</p>
          <p className="font-bold text-xl tabular-nums">{fmt(total)}</p>
        </div>
      </div>

      {/* Per-person breakdown */}
      <div className="divide-y divide-gray-100">
        {people.map((person, pi) => {
          const color = PERSON_COLORS[pi % PERSON_COLORS.length]
          const data = split[person]
          const hasPersonal = data.personalItems.length > 0
          const hasShared = data.sharedItems.length > 0 || data.taxTipShare > 0

          return (
            <div key={person} className="p-5">
              {/* Person header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className={`w-10 h-10 rounded-full ${color.avatar} flex items-center justify-center text-white text-base font-bold shadow-sm`}>
                    {person[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="font-bold text-gray-900 text-base">{person}</p>
                    <p className="text-xs text-gray-400">owes in total</p>
                  </div>
                </div>
                <div className={`px-4 py-2 rounded-xl border-2 font-bold text-xl tabular-nums ${color.total}`}>
                  {fmt(data.total)}
                </div>
              </div>

              {/* Personal items section */}
              {hasPersonal && (
                <div className="mb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-px flex-1 bg-gray-100" />
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Personal</span>
                    <div className="h-px flex-1 bg-gray-100" />
                  </div>
                  <div className="space-y-1.5">
                    {data.personalItems.map((item, ii) => (
                      <div key={ii} className="flex items-center justify-between">
                        <span className="text-sm text-gray-700 flex-1 mr-2">{item.name}</span>
                        <span className="text-sm font-semibold text-gray-900 tabular-nums">{fmt(item.price)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Shared items section */}
              {hasShared && (
                <div className={hasPersonal ? 'mt-3' : ''}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-px flex-1 bg-gray-100" />
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Shared ÷{people.length}</span>
                    <div className="h-px flex-1 bg-gray-100" />
                  </div>
                  <div className="space-y-1.5">
                    {data.sharedItems.map((item, ii) => (
                      <div key={ii} className="flex items-center justify-between">
                        <div className="flex-1 mr-2">
                          <span className="text-sm text-gray-600">{item.name}</span>
                          <span className="text-xs text-gray-400 ml-1.5">({fmt(item.fullPrice)} ÷ {people.length})</span>
                        </div>
                        <span className="text-sm font-medium text-gray-700 tabular-nums">{fmt(item.share)}</span>
                      </div>
                    ))}
                    {data.taxTipShare > 0 && (
                      <div className="flex items-center justify-between">
                        <div className="flex-1 mr-2">
                          <span className="text-sm text-gray-600">{taxLabel}</span>
                          <span className="text-xs text-gray-400 ml-1.5">(equal split)</span>
                        </div>
                        <span className="text-sm font-medium text-gray-700 tabular-nums">{fmt(data.taxTipShare)}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Tax note */}
      {taxTip > 0 && (
        <div className="mx-4 mb-4 p-3.5 rounded-xl bg-amber-50 border border-amber-100 flex items-start gap-2.5">
          <span className="text-base flex-shrink-0 mt-0.5">ℹ️</span>
          <p className="text-xs text-amber-800 leading-relaxed">
            <span className="font-semibold">{taxLabel} note:</span> The total {taxLabel.toLowerCase()} of{' '}
            <span className="font-semibold">{fmt(taxTip)}</span> has been divided equally among all{' '}
            {people.length} people (<span className="font-semibold">{fmt(taxTip / people.length)}</span> each),
            since the exact per-item tax rate is unknown.
          </p>
        </div>
      )}

      {/* Full text block */}
      <div className="mx-4 mb-4 rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
          <div>
            <p className="text-xs font-bold text-gray-700">Full Summary Text</p>
            <p className="text-xs text-gray-400 mt-0.5">Copy everything — paste as a Splitwise note or share with friends</p>
          </div>
          <button
            onClick={() => onCopy(fullText)}
            className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-all flex-shrink-0 ml-3 ${
              copied ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 border border-indigo-200'
            }`}
          >
            {copied ? '✅ Copied!' : '📋 Copy'}
          </button>
        </div>
        <pre className="px-4 py-4 text-xs text-gray-700 leading-relaxed whitespace-pre-wrap font-mono bg-white overflow-x-auto">
          {fullText}
        </pre>
      </div>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [peopleDialogOpen, setPeopleDialogOpen] = useState(false)

  // People persisted to localStorage
  const [people, setPeople] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sw-people') || '[]') } catch { return [] }
  })
  useEffect(() => {
    localStorage.setItem('sw-people', JSON.stringify(people))
  }, [people])

  const [selectedFile, setSelectedFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [isDragging, setIsDragging] = useState(false)

  const [loading, setLoading] = useState(false)
  const [receiptMeta, setReceiptMeta] = useState(null)
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [editingTax, setEditingTax] = useState(false)
  const [taxValue, setTaxValue] = useState('0')

  const [splitSummary, setSplitSummary] = useState(null) // full split data object
  const [copied, setCopied] = useState(false)

  const hasResults = items.length > 0

  // Calculate subtotal from items
  const subtotal = items.reduce((sum, item) => sum + (Number(item.price) || 0), 0)
  const tax = parseFloat(taxValue) || 0
  const tip = receiptMeta?.tip || 0
  const total = subtotal + tax + tip

  // ── File handling ──────────────────────────────────────────────────────────

  const handleFileSelect = useCallback(async (file) => {
    if (!file) return
    setSelectedFile(file)
    setError('')
    setReceiptMeta(null)
    setItems([])
    setSplitSummary(null)
    try { setPreview(await getPreviewURL(file)) } catch { setPreview(null) }
  }, [])

  const handleClear = useCallback(() => {
    setSelectedFile(null)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    setError('')
    setReceiptMeta(null)
    setItems([])
    setSplitSummary(null)
    setTaxValue('0')
  }, [preview])

  const handleDragOver = useCallback((e) => { e.preventDefault(); setIsDragging(true) }, [])
  const handleDragLeave = useCallback(() => setIsDragging(false), [])
  const handleDrop = useCallback((e) => {
    e.preventDefault(); setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file?.type.startsWith('image/') || isHeicFile(file || {})) handleFileSelect(file)
  }, [handleFileSelect])

  // ── Analyze ────────────────────────────────────────────────────────────────

  const handleAnalyze = async () => {
    if (!selectedFile) return
    setLoading(true)
    setError('')
    setReceiptMeta(null)
    setItems([])
    setSplitSummary(null)
    try {
      const raw = await analyzeImageWithGemini(selectedFile)
      const data = extractJSON(raw)
      setReceiptMeta({
        merchant: data.merchant || 'Unknown',
        date: data.date || 'Unknown',
        tip: Number(data.tip) || 0,
        currency: data.currency || 'USD',
      })
      setTaxValue(String(Number(data.tax) || 0))
      setItems((data.items || []).map(it => ({
        name: String(it.name || 'Item'),
        price: Number(it.price) || 0,
        assignedTo: 'shared',
      })))
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Item assignment ────────────────────────────────────────────────────────

  const handleAssign = (index, assignedTo) => {
    setItems(prev => prev.map((it, i) => i === index ? { ...it, assignedTo } : it))
    setSplitSummary(null)
  }

  const handleUpdatePrice = (index, newPrice) => {
    setItems(prev => prev.map((it, i) => i === index ? { ...it, price: newPrice } : it))
    setSplitSummary(null)
  }

  // ── Generate summary ───────────────────────────────────────────────────────

  const handleGenerateSummary = () => {
    const data = calcSplit(people, items, { tax, tip })
    setSplitSummary(data)
    setTimeout(() => {
      document.getElementById('summary-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }

  const handleCopy = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }).catch(() => {})
  }

  // ── Live split totals ──────────────────────────────────────────────────────

  const liveSplit = hasResults && people.length > 0 ? calcSplit(people, items, { tax, tip }) : null

  const handleNavAction = (action) => {
    if (action === 'settings') {
      setSettingsDialogOpen(true)
    } else if (action === 'home') {
      // Home action if needed
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header onMenuClick={() => setDrawerOpen(true)} />
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} onNavAction={handleNavAction} />
      <SettingsDialog open={settingsDialogOpen} onClose={() => setSettingsDialogOpen(false)} />
      <PeopleDialog
        open={peopleDialogOpen}
        onClose={() => setPeopleDialogOpen(false)}
        people={people}
        onPeopleChange={setPeople}
      />

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 sm:py-10 flex flex-col gap-5">

        {/* Hero */}
        <div className="rounded-2xl gradient-brand p-5 sm:p-7 text-white shadow-lg relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-white/10" />
          <div className="absolute -bottom-6 -left-6 w-28 h-28 rounded-full bg-white/10" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">💸</span>
            </div>
            <h1 className="text-lg sm:text-xl font-bold leading-snug mb-1">Snap. Split. Done.</h1>
            <p className="text-indigo-100 text-xs sm:text-sm leading-relaxed max-w-xs">
              Upload any bill, assign items to people, and get a Splitwise-ready summary instantly.
            </p>
          </div>
        </div>

        {/* People card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-semibold text-gray-800">Who's splitting?</p>
              <p className="text-xs text-gray-400 mt-0.5">Saved automatically across sessions</p>
            </div>
            <button
              onClick={() => setPeopleDialogOpen(true)}
              className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-xl gradient-brand text-white shadow-sm hover:shadow-md transition-shadow"
            >
              <span className="text-sm">+</span> Add People
            </button>
          </div>
          {people.length === 0 ? (
            <p className="text-xs text-gray-300 py-1">No people added — all items will be shared.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {people.map((person, i) => {
                const color = PERSON_COLORS[i % PERSON_COLORS.length]
                return (
                  <div key={person} className={`flex items-center gap-1.5 pl-1.5 pr-3 py-1 rounded-full border text-xs font-medium ${color.pill}`}>
                    <div className={`w-5 h-5 rounded-full ${color.avatar} flex items-center justify-center text-white text-xs font-bold`}>
                      {person[0].toUpperCase()}
                    </div>
                    {person}
                  </div>
                )
              })}
              <button onClick={() => setPeopleDialogOpen(true)}
                className="text-xs text-indigo-400 hover:text-indigo-600 font-medium px-2 py-1 rounded-full hover:bg-indigo-50 transition-colors">
                Edit
              </button>
            </div>
          )}
        </div>

        {/* Upload + Analyze */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
          <ImageUploadZone
            onFileSelect={handleFileSelect} preview={preview} isDragging={isDragging}
            onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} onClear={handleClear}
          />
          {error && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-100">
              <span className="text-base mt-0.5">⚠️</span>
              <div>
                <p className="text-sm font-semibold text-red-700 mb-0.5">Analysis failed</p>
                <p className="text-xs text-red-500 leading-relaxed">{error}</p>
              </div>
            </div>
          )}
          <button onClick={handleAnalyze} disabled={!selectedFile || loading}
            className={`w-full py-3.5 px-6 rounded-xl font-semibold text-sm transition-all duration-200 flex items-center justify-center gap-2
              ${selectedFile && !loading ? 'gradient-brand text-white shadow-md hover:shadow-lg hover:scale-[1.01] active:scale-[0.99]' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
            {loading
              ? <><span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />Analyzing receipt…</>
              : <><span>✨</span> Analyze with AI</>}
          </button>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col items-center justify-center py-12 gap-4">
            <div className="relative w-12 h-12">
              <div className="absolute inset-0 rounded-full border-4 border-indigo-100" />
              <div className="absolute inset-0 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-gray-700">Reading your receipt…</p>
              <p className="text-xs text-gray-400 mt-1">Extracting items and prices</p>
            </div>
          </div>
        )}

        {/* Items card */}
        {hasResults && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {/* Receipt header */}
            <div className="gradient-brand px-5 py-4 text-white">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-bold text-base">{receiptMeta.merchant}</p>
                  {receiptMeta.date !== 'Unknown' && <p className="text-indigo-200 text-xs mt-0.5">{receiptMeta.date}</p>}
                </div>
                <div className="text-right">
                  <p className="text-xs text-indigo-200">Total</p>
                  <p className="font-bold text-xl tabular-nums">{fmt(total)}</p>
                </div>
              </div>
              {(tax > 0 || tip > 0 || editingTax) && (
                <div className="flex gap-3 mt-2 pt-2 border-t border-indigo-400/30">
                  {subtotal > 0 && <span className="text-xs text-indigo-200">Subtotal {fmt(subtotal)}</span>}
                  <div className="flex items-center gap-1">
                    {!editingTax ? (
                      <>
                        <span className="text-xs text-indigo-200 cursor-pointer hover:text-white transition-colors" onClick={() => { setEditingTax(true); }}>Tax {fmt(tax)}</span>
                        <button
                          onClick={() => setEditingTax(true)}
                          className="text-xs text-indigo-200 hover:text-white px-1 transition-colors"
                          title="Edit tax"
                        >
                          ✎
                        </button>
                      </>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="text-xs">$</span>
                        <input
                          type="number"
                          step="0.01"
                          value={taxValue}
                          onChange={(e) => setTaxValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') setEditingTax(false)
                            if (e.key === 'Escape') { setTaxValue(String(tax)); setEditingTax(false) }
                          }}
                          className="w-12 px-1 text-xs font-medium appearance-none focus:outline-none bg-indigo-600 rounded text-white"
                          autoFocus
                        />
                        <button
                          onClick={() => setEditingTax(false)}
                          className="text-xs text-white hover:opacity-80 px-1 transition-opacity"
                        >
                          ✓
                        </button>
                      </div>
                    )}
                  </div>
                  {tip > 0 && <span className="text-xs text-indigo-200">Tip {fmt(tip)}</span>}
                </div>
              )}
              {tax === 0 && tip === 0 && !editingTax && (
                <p className="text-xs text-indigo-300 mt-2 cursor-pointer hover:text-white transition-colors" onClick={() => { setEditingTax(true); }}>
                  💡 Click to add tax or tip
                </p>
              )}
            </div>

            <div className="px-5 pt-4 pb-1 flex items-center gap-2">
              <p className="text-sm font-semibold text-gray-800">Items</p>
              <span className="text-xs text-gray-400">· tap a pill to assign</span>
            </div>

            <div className="px-5 pb-2">
              {items.map((item, i) => (
                <ItemRow key={i} item={item} index={i} people={people} onAssign={handleAssign} onUpdatePrice={handleUpdatePrice} />
              ))}
            </div>

            {/* Live split totals */}
            {liveSplit && (
              <div className="px-5 pb-5 pt-3 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Current Split</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {people.map((person, i) => {
                    const color = PERSON_COLORS[i % PERSON_COLORS.length]
                    return (
                      <div key={person} className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border ${color.total}`}>
                        <div className={`w-6 h-6 rounded-full ${color.avatar} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
                          {person[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{person}</p>
                          <p className="text-sm font-bold tabular-nums">{fmt(liveSplit[person].total)}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Tax warning */}
            {(tax > 0 || tip > 0) && (
              <div className="mx-5 mb-4 p-3.5 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2.5">
                <span className="text-base flex-shrink-0">⚠️</span>
                <div>
                  <p className="text-xs font-bold text-amber-800 mb-0.5">
                    {tax > 0 && tip > 0 ? 'Tax & Tip' : tax > 0 ? 'Tax' : 'Tip'} detected
                    {' '}— {[tax > 0 && `Tax ${fmt(tax)}`, tip > 0 && `Tip ${fmt(tip)}`].filter(Boolean).join('  +  ')}
                  </p>
                  <p className="text-xs text-amber-700 leading-relaxed">
                    This will be <span className="font-semibold">divided equally</span> among all {people.length || 'N'} people
                    {people.length > 0 ? ` (${fmt(((tax || 0) + (tip || 0)) / people.length)}/person)` : ''}.
                    Per-item tax rates are unknown, so equal split is used.
                  </p>
                </div>
              </div>
            )}

            {/* Generate summary button */}
            <div className="px-5 pb-5">
              <button
                onClick={handleGenerateSummary}
                disabled={people.length === 0}
                className={`w-full py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all
                  ${people.length > 0 ? 'gradient-brand text-white shadow-md hover:shadow-lg hover:scale-[1.01] active:scale-[0.99]' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
              >
                <span>📊</span>
                {people.length === 0 ? 'Add people first to generate summary' : 'Generate Split Summary'}
              </button>
              {people.length === 0 && (
                <p className="text-center text-xs text-gray-400 mt-2">Add people in the card above first</p>
              )}
            </div>
          </div>
        )}

        {/* Summary card */}
        {splitSummary && (
          <SummaryCard
            people={people}
            split={splitSummary}
            meta={receiptMeta}
            subtotal={subtotal}
            tax={tax}
            tip={tip}
            total={total}
            onCopy={handleCopy}
            copied={copied}
          />
        )}

        {/* Tips */}
        {!selectedFile && !hasResults && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: '🧾', title: 'Receipts', desc: 'Restaurant, grocery bills' },
              { icon: '✈️', title: 'Travel', desc: 'Hotel, transport invoices' },
              { icon: '🏠', title: 'Utilities', desc: 'Rent, electricity, shared' },
            ].map(tip => (
              <div key={tip.title} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm text-center">
                <div className="text-2xl mb-2">{tip.icon}</div>
                <p className="text-xs font-semibold text-gray-700 mb-1">{tip.title}</p>
                <p className="text-xs text-gray-400 leading-tight">{tip.desc}</p>
              </div>
            ))}
          </div>
        )}
      </main>

      <footer className="py-5 px-4 text-center border-t border-gray-100 bg-white">
        <p className="text-xs text-gray-400">
          © 2025 <span className="text-indigo-500 font-medium">Splitwiser Summary AI</span>
        </p>
      </footer>
    </div>
  )
}
