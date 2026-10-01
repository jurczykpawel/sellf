'use client'

import React, { createContext, useContext } from 'react'
import type { TrackingConfigFromDB } from '@/lib/tracking/types'

const TrackingConfigContext = createContext<TrackingConfigFromDB | null>(null)

interface TrackingConfigProviderProps {
  config: TrackingConfigFromDB | null
  children: React.ReactNode
}

export function TrackingConfigProvider({ config, children }: TrackingConfigProviderProps) {
  return (
    <TrackingConfigContext.Provider value={config}>
      {children}
    </TrackingConfigContext.Provider>
  )
}

export function useTrackingConfig() {
  return useContext(TrackingConfigContext)
}
