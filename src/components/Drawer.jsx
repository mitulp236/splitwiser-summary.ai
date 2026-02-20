import { useEffect } from 'react'

const navItems = [
  { icon: '🏠', label: 'Home', href: '#', action: 'home' },
  { icon: '⚙️', label: 'Settings', href: '#', action: 'settings' },
]

export default function Drawer({ open, onClose, onNavAction }) {
  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Lock body scroll when open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <aside
        className={`fixed top-0 left-0 z-50 h-full w-72 bg-white shadow-2xl transform transition-transform duration-300 ease-out flex flex-col ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Navigation drawer"
      >
        {/* Drawer header */}
        <div className="gradient-brand px-6 py-8 flex items-center gap-3 relative">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-xl">
            💸
          </div>
          <div>
            <p className="text-white font-bold text-base leading-tight">Splitwiser</p>
            <p className="text-indigo-200 text-xs font-medium">Summary AI</p>
          </div>
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
            aria-label="Close drawer"
          >
            ✕
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-4 overflow-y-auto scrollbar-hide">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              onClick={(e) => {
                e.preventDefault()
                onClose()
                if (item.action && onNavAction) {
                  onNavAction(item.action)
                }
              }}
              className="flex items-center gap-3 px-5 py-3.5 mx-2 rounded-xl text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 transition-colors group"
            >
              <span className="text-xl w-7 text-center">{item.icon}</span>
              <span className="flex-1 font-medium text-sm">{item.label}</span>
              {item.badge && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-500 font-medium">
                  {item.badge}
                </span>
              )}
            </a>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100">
          <p className="text-xs text-gray-400 text-center leading-relaxed">
            Splitwiser Summary AI<br />
            <span className="text-indigo-400 font-medium">v1.0.0</span>
          </p>
        </div>
      </aside>
    </>
  )
}
