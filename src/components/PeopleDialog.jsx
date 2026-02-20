import { useState, useEffect, useRef } from 'react'

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-emerald-500', 'bg-orange-500',
  'bg-pink-500', 'bg-violet-500', 'bg-amber-500',
]

export default function PeopleDialog({ open, onClose, people, onPeopleChange }) {
  const [input, setInput] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (open) {
      setInput('')
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [open])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  const addPerson = () => {
    const name = input.trim()
    if (!name || people.map(p => p.toLowerCase()).includes(name.toLowerCase())) return
    onPeopleChange([...people, name])
    setInput('')
    inputRef.current?.focus()
  }

  const removePerson = (name) => {
    onPeopleChange(people.filter(p => p !== name))
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-50 bg-black/40 backdrop-blur-sm transition-opacity duration-200 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      <div
        className={`fixed inset-x-4 top-1/2 z-50 -translate-y-1/2 max-w-sm mx-auto bg-white rounded-2xl shadow-2xl transition-all duration-200 ${
          open ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <div>
            <h2 className="font-bold text-gray-900 text-base">Who's splitting?</h2>
            <p className="text-xs text-gray-400 mt-0.5">Add everyone sharing this bill</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 text-sm transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Input */}
        <div className="px-5 py-4">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addPerson()}
              placeholder="Enter a name…"
              maxLength={30}
              className="flex-1 px-3.5 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all"
            />
            <button
              onClick={addPerson}
              disabled={!input.trim()}
              className="px-4 py-2.5 rounded-xl gradient-brand text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              Add
            </button>
          </div>
        </div>

        {/* People list */}
        <div className="px-5 pb-4 min-h-16">
          {people.length === 0 ? (
            <p className="text-center text-sm text-gray-300 py-4">No one added yet</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {people.map((person, i) => (
                <div
                  key={person}
                  className="flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full bg-gray-50 border border-gray-200"
                >
                  <div className={`w-6 h-6 rounded-full ${AVATAR_COLORS[i % AVATAR_COLORS.length]} flex items-center justify-center text-white text-xs font-bold`}>
                    {person[0].toUpperCase()}
                  </div>
                  <span className="text-sm font-medium text-gray-700">{person}</span>
                  <button
                    onClick={() => removePerson(person)}
                    className="text-gray-300 hover:text-red-400 text-xs leading-none transition-colors ml-0.5"
                    aria-label={`Remove ${person}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl gradient-brand text-white font-semibold text-sm"
          >
            {people.length === 0 ? 'Done' : `Done · ${people.length} ${people.length === 1 ? 'person' : 'people'}`}
          </button>
        </div>
      </div>
    </>
  )
}
