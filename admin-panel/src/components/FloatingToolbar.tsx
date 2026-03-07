'use client'

import SiteMenu from '@/components/SiteMenu'

interface FloatingToolbarProps {
  position?: 'top-right' | 'top-left'
  mode?: 'floating' | 'inline'
}

export default function FloatingToolbar({
  position = 'top-right',
  mode = 'floating',
}: FloatingToolbarProps) {
  return <SiteMenu position={position} mode={mode} />
}
