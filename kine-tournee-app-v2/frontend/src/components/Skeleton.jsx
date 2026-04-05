export function Skeleton({ width = '100%', height = 16, radius = 8, style = {} }) {
  return (
    <div
      className="skeleton"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  )
}

export function SkeletonCard({ lines = 3 }) {
  return (
    <div className="card" style={{ gap: 10, display: 'grid' }}>
      <Skeleton height={20} width="60%" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={14} width={i === lines - 1 ? '40%' : '100%'} />
      ))}
    </div>
  )
}

export function SkeletonPatient() {
  return (
    <div className="patient-card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <Skeleton width={44} height={44} radius={999} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, display: 'grid', gap: 6 }}>
        <Skeleton height={16} width="55%" />
        <Skeleton height={12} width="80%" />
        <Skeleton height={12} width="40%" />
      </div>
    </div>
  )
}
