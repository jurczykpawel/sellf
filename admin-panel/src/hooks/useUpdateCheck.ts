'use client';

/**
 * Hook for checking application updates.
 *
 * Auto-checks on mount with smart caching:
 * - Server-side: 1h cache (GitHub API)
 * - Client localStorage: 6h cache
 * - Dismissed version: 24h before re-showing
 *
 * @see /api/v1/system/update-check
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const STORAGE_KEY = 'sellf_update_check';
const DISMISSED_KEY = 'sellf_update_dismissed';
const CLIENT_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const DISMISS_TTL = 24 * 60 * 60 * 1000; // 24 hours

export interface UpdateInfo {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  release_notes: string | null;
  published_at: string | null;
  release_url: string | null;
}

export interface UpgradeProgress {
  step: string;
  progress: number;
  message: string;
  rollback?: boolean;
  timestamp?: string;
}

interface CachedCheck {
  data: UpdateInfo;
  timestamp: number;
}

interface DismissedVersion {
  version: string;
  timestamp: number;
}

export interface UseUpdateCheckResult {
  updateInfo: UpdateInfo | null;
  isChecking: boolean;
  showModal: boolean;
  upgradeInProgress: boolean;
  upgradeProgress: UpgradeProgress | null;
  checkNow: (force?: boolean) => Promise<void>;
  dismissUpdate: () => void;
  startUpgrade: () => Promise<void>;
}

export function useUpdateCheck(isAdmin: boolean): UseUpdateCheckResult {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [upgradeInProgress, setUpgradeInProgress] = useState(false);
  const [upgradeProgress, setUpgradeProgress] = useState<UpgradeProgress | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isDismissed = useCallback((version: string): boolean => {
    try {
      const raw = localStorage.getItem(DISMISSED_KEY);
      if (!raw) return false;
      const dismissed: DismissedVersion = JSON.parse(raw);
      if (dismissed.version !== version) return false;
      return Date.now() - dismissed.timestamp < DISMISS_TTL;
    } catch {
      return false;
    }
  }, []);

  const checkForUpdate = useCallback(async (force = false) => {
    if (!isAdmin) return;

    // Check client cache
    if (!force) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const cached: CachedCheck = JSON.parse(raw);
          if (Date.now() - cached.timestamp < CLIENT_CACHE_TTL) {
            setUpdateInfo(cached.data);
            if (cached.data.update_available && !isDismissed(cached.data.latest_version)) {
              setShowModal(true);
            }
            return;
          }
        }
      } catch {
        // Ignore corrupted cache
      }
    }

    setIsChecking(true);
    try {
      const url = force
        ? '/api/v1/system/update-check?force=true'
        : '/api/v1/system/update-check';
      const response = await fetch(url);

      if (!response.ok) return;

      const json = await response.json();
      const data: UpdateInfo = json.data;
      setUpdateInfo(data);

      // Cache in localStorage
      const cached: CachedCheck = { data, timestamp: Date.now() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));

      if (data.update_available && !isDismissed(data.latest_version)) {
        setShowModal(true);
      }
    } catch {
      // Silent fail — don't bother user with update check errors
    } finally {
      setIsChecking(false);
    }
  }, [isAdmin, isDismissed]);

  const dismissUpdate = useCallback(() => {
    setShowModal(false);
    if (updateInfo?.latest_version) {
      const dismissed: DismissedVersion = {
        version: updateInfo.latest_version,
        timestamp: Date.now(),
      };
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissed));
    }
  }, [updateInfo]);

  const pollUpgradeStatus = useCallback((token: string) => {
    // Clear any existing poll
    if (pollRef.current) clearInterval(pollRef.current);

    let healthPollCount = 0;
    let switchedToHealthPoll = false;
    let consecutiveErrors = 0;

    pollRef.current = setInterval(async () => {
      try {
        if (!switchedToHealthPoll) {
          const response = await fetch(`/api/v1/system/upgrade-status?token=${token}`, {
            signal: AbortSignal.timeout(5000),
          });
          if (response.ok) {
            consecutiveErrors = 0;
            const json = await response.json();
            const progress: UpgradeProgress = json.data;
            setUpgradeProgress(progress);

            if (progress.step === 'done') {
              if (pollRef.current) clearInterval(pollRef.current);
              setUpgradeInProgress(false);
              localStorage.removeItem(STORAGE_KEY);
              localStorage.removeItem(DISMISSED_KEY);
              setTimeout(() => window.location.reload(), 3000);
              return;
            }

            if (progress.step === 'failed') {
              if (pollRef.current) clearInterval(pollRef.current);
              setUpgradeInProgress(false);
              return;
            }

            if (progress.step === 'restarting') {
              switchedToHealthPoll = true;
            }
          } else {
            consecutiveErrors++;
          }
        }

        // Switch to health polling when server is explicitly restarting,
        // OR when 3+ consecutive network errors (server went down during upgrade)
        if (!switchedToHealthPoll && consecutiveErrors >= 3) {
          switchedToHealthPoll = true;
          setUpgradeProgress({
            step: 'restarting',
            progress: 90,
            message: 'Server is restarting...',
          });
        }

        if (switchedToHealthPoll) {
          healthPollCount++;
          try {
            const healthResp = await fetch('/api/health', { signal: AbortSignal.timeout(3000) });
            if (healthResp.ok) {
              const health = await healthResp.json();
              if (pollRef.current) clearInterval(pollRef.current);
              setUpgradeProgress({
                step: 'done',
                progress: 100,
                message: `Upgrade to v${health.version} completed!`,
              });
              setUpgradeInProgress(false);
              localStorage.removeItem(STORAGE_KEY);
              localStorage.removeItem(DISMISSED_KEY);
              setTimeout(() => window.location.reload(), 3000);
              return;
            }
          } catch {
            // Server still restarting — expected
          }

          if (healthPollCount > 30) {
            if (pollRef.current) clearInterval(pollRef.current);
            setUpgradeProgress({
              step: 'failed',
              progress: -1,
              message: 'Server did not respond after 90 seconds. Check server logs.',
            });
            setUpgradeInProgress(false);
          }
        }
      } catch {
        consecutiveErrors++;
      }
    }, 3000);
  }, []);

  const startUpgrade = useCallback(async () => {
    setUpgradeInProgress(true);
    setUpgradeProgress({
      step: 'starting',
      progress: 0,
      message: 'Initiating upgrade...',
    });

    try {
      const response = await fetch('/api/v1/system/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const errJson = await response.json();
        setUpgradeProgress({
          step: 'failed',
          progress: -1,
          message: errJson.error?.message || 'Failed to start upgrade',
        });
        setUpgradeInProgress(false);
        return;
      }

      const json = await response.json();
      pollUpgradeStatus(json.data.token);
    } catch {
      setUpgradeProgress({
        step: 'failed',
        progress: -1,
        message: 'Network error while starting upgrade',
      });
      setUpgradeInProgress(false);
    }
  }, [pollUpgradeStatus]);

  // Auto-check on mount
  useEffect(() => {
    if (isAdmin) {
      checkForUpdate();
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isAdmin, checkForUpdate]);

  return {
    updateInfo,
    isChecking,
    showModal,
    upgradeInProgress,
    upgradeProgress,
    checkNow: checkForUpdate,
    dismissUpdate,
    startUpgrade,
  };
}
