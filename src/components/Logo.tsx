type LogoProps = {
  className?: string;
  markClassName?: string;
  showWordmark?: boolean;
  variant?: 'light' | 'dark';
};

export default function Logo({
  className = '',
  markClassName = 'w-10 h-10',
  showWordmark = true,
  variant = 'dark',
}: LogoProps) {
  const titleColor = variant === 'dark' ? 'text-white' : 'text-slate-900';
  const subtitleColor = variant === 'dark' ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <img
        src="/logo-mark.svg"
        alt=""
        className={`shrink-0 ${markClassName}`}
        width={40}
        height={40}
      />
      {showWordmark && (
        <div className="min-w-0 leading-tight">
          <div className={`${titleColor} font-bold text-lg tracking-wider`}>TR REP AGENCY</div>
          <div className={`${subtitleColor} text-xs uppercase tracking-widest mt-0.5`}>
            Repair Management
          </div>
        </div>
      )}
    </div>
  );
}
