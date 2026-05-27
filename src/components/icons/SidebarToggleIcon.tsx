// Корпоративная двупанельная иконка (WB-стиль IconLayoutSidebar).
// Зеркалируется в collapsed-режиме, чтобы визуально передать «панель закрыта».

interface Props {
  size?: number;
  collapsed?: boolean;
  className?: string;
}

export function SidebarToggleIcon({ size = 20, collapsed = false, className }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      fill="none"
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      style={{
        transform: collapsed ? 'scaleX(-1)' : undefined,
        transition: 'transform 120ms ease',
      }}
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M6 5.416a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h2v-14zm0-2a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-12a3 3 0 0 0-3-3zm4 2v14h8a1 1 0 0 0 1-1v-12a1 1 0 0 0-1-1z"
        clipRule="evenodd"
      />
    </svg>
  );
}
