export default function Header({ onMenuClick }) {
  return (
    <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-100 shadow-sm">
      <div className="max-w-3xl mx-auto px-4 h-16 flex items-center gap-3">
        {/* Hamburger */}
        <button
          onClick={onMenuClick}
          className="w-9 h-9 rounded-lg flex flex-col items-center justify-center gap-1.5 text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
          aria-label="Open menu"
        >
          <span className="w-5 h-0.5 bg-current rounded-full" />
          <span className="w-5 h-0.5 bg-current rounded-full" />
          <span className="w-3.5 h-0.5 bg-current rounded-full self-start ml-0.5" />
        </button>

        {/* Logo */}
        <div className="flex items-center gap-2 flex-1">
          <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center text-base shadow-sm">
            💸
          </div>
          <div className="leading-tight">
            <span className="font-bold text-gray-900 text-sm sm:text-base">Splitwiser</span>
            <span className="text-indigo-500 font-semibold text-sm sm:text-base"> Summary</span>
            <span className="text-gray-400 font-light text-xs sm:text-sm"> .ai</span>
          </div>
        </div>

      </div>
    </header>
  )
}
