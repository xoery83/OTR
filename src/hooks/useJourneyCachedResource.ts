"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CacheStatus = "idle" | "loading" | "success" | "error";

type CacheEntry<T> = {
  data?: T;
  error: unknown;
  status: CacheStatus;
  updatedAt: number;
  promise: Promise<T> | null;
  subscribers: Set<() => void>;
};

type CacheSnapshot<T> = {
  data: T | undefined;
  error: unknown;
  isLoading: boolean;
  isRefreshing: boolean;
  isStale: boolean;
  updatedAt: number | null;
};

export type JourneyCachedResourceOptions<T> = {
  cacheKey: string | null | undefined;
  loader: () => Promise<T>;
  ttl?: number;
  staleTime?: number;
  keepPreviousData?: boolean;
  backgroundRefresh?: boolean;
  enabled?: boolean;
  fallbackData?: T;
};

const DEFAULT_TTL = 5 * 60_000;
const DEFAULT_STALE_TIME = 30_000;

const cache = new Map<string, CacheEntry<unknown>>();

function now() {
  return Date.now();
}

function getEntry<T>(cacheKey: string): CacheEntry<T> {
  const existing = cache.get(cacheKey) as CacheEntry<T> | undefined;
  if (existing) return existing;

  const entry: CacheEntry<T> = {
    error: null,
    status: "idle",
    updatedAt: 0,
    promise: null,
    subscribers: new Set(),
  };
  cache.set(cacheKey, entry as CacheEntry<unknown>);
  return entry;
}

function notify(entry: CacheEntry<unknown>) {
  entry.subscribers.forEach((subscriber) => subscriber());
}

function isExpired(entry: CacheEntry<unknown>, ttl: number) {
  return entry.updatedAt > 0 && now() - entry.updatedAt > ttl;
}

function isStale(entry: CacheEntry<unknown>, staleTime: number) {
  return entry.updatedAt === 0 || now() - entry.updatedAt > staleTime;
}

async function loadJourneyResource<T>(
  cacheKey: string,
  loader: () => Promise<T>,
  options: { ttl: number; force?: boolean } = { ttl: DEFAULT_TTL },
) {
  const entry = getEntry<T>(cacheKey);
  if (!options.force && entry.promise) return entry.promise;
  if (!options.force && entry.data !== undefined && !isExpired(entry, options.ttl)) {
    return entry.data;
  }

  const hasPreviousData = entry.data !== undefined;
  entry.status = hasPreviousData ? "success" : "loading";
  entry.error = null;
  notify(entry as CacheEntry<unknown>);

  entry.promise = loader()
    .then((data) => {
      entry.data = data;
      entry.error = null;
      entry.status = "success";
      entry.updatedAt = now();
      return data;
    })
    .catch((error) => {
      entry.error = error;
      entry.status = entry.data !== undefined ? "success" : "error";
      throw error;
    })
    .finally(() => {
      entry.promise = null;
      notify(entry as CacheEntry<unknown>);
    });

  notify(entry as CacheEntry<unknown>);
  return entry.promise;
}

export function invalidateJourneyResource(cacheKey: string) {
  const entry = cache.get(cacheKey);
  if (!entry) return;
  entry.updatedAt = 0;
  notify(entry);
}

export function invalidateJourneyResourcePrefix(prefix: string) {
  cache.forEach((entry, cacheKey) => {
    if (cacheKey.startsWith(prefix)) {
      entry.updatedAt = 0;
      notify(entry);
    }
  });
}

export function prefetchJourneyResource<T>(
  cacheKey: string,
  loader: () => Promise<T>,
  options: { ttl?: number; force?: boolean } = {},
) {
  return loadJourneyResource(cacheKey, loader, {
    ttl: options.ttl ?? DEFAULT_TTL,
    force: options.force,
  }).catch(() => undefined);
}

export function useJourneyCachedResource<T>({
  cacheKey,
  loader,
  ttl = DEFAULT_TTL,
  staleTime = DEFAULT_STALE_TIME,
  keepPreviousData = true,
  backgroundRefresh = true,
  enabled = true,
  fallbackData,
}: JourneyCachedResourceOptions<T>) {
  const loaderRef = useRef(loader);
  const previousDataRef = useRef<T | undefined>(fallbackData);
  loaderRef.current = loader;

  const readSnapshot = useCallback((): CacheSnapshot<T> => {
    if (!cacheKey) {
      return {
        data: previousDataRef.current,
        error: null,
        isLoading: false,
        isRefreshing: false,
        isStale: false,
        updatedAt: null,
      };
    }

    const entry = getEntry<T>(cacheKey);
    const entryData = entry.data ?? fallbackData;
    const data =
      entryData !== undefined
        ? entryData
        : keepPreviousData
          ? previousDataRef.current
          : undefined;
    const hasVisibleData = data !== undefined;

    return {
      data,
      error: entry.error,
      isLoading:
        enabled &&
        !hasVisibleData &&
        (entry.status === "idle" || entry.status === "loading"),
      isRefreshing: enabled && hasVisibleData && Boolean(entry.promise),
      isStale: isStale(entry, staleTime),
      updatedAt: entry.updatedAt || null,
    };
  }, [cacheKey, enabled, fallbackData, keepPreviousData, staleTime]);

  const [snapshot, setSnapshot] = useState<CacheSnapshot<T>>(readSnapshot);

  useEffect(() => {
    setSnapshot(readSnapshot());
  }, [readSnapshot]);

  useEffect(() => {
    if (!cacheKey) return;
    const entry = getEntry<T>(cacheKey);
    const subscriber = () => {
      const next = readSnapshot();
      if (next.data !== undefined) previousDataRef.current = next.data;
      setSnapshot(next);
    };
    entry.subscribers.add(subscriber);
    subscriber();
    return () => {
      entry.subscribers.delete(subscriber);
    };
  }, [cacheKey, readSnapshot]);

  const refresh = useCallback(
    (force = true) => {
      if (!cacheKey || !enabled) return Promise.resolve(undefined);
      return loadJourneyResource(cacheKey, () => loaderRef.current(), {
        ttl,
        force,
      }).catch((error) => {
        setSnapshot(readSnapshot());
        return Promise.reject(error);
      });
    },
    [cacheKey, enabled, readSnapshot, ttl],
  );

  useEffect(() => {
    if (!cacheKey || !enabled) return;
    const entry = getEntry<T>(cacheKey);
    if (entry.data !== undefined) previousDataRef.current = entry.data;

    const shouldRefresh = entry.data === undefined || isExpired(entry, ttl);
    const shouldBackgroundRefresh =
      entry.data !== undefined && backgroundRefresh && isStale(entry, staleTime);

    if (shouldRefresh || shouldBackgroundRefresh) {
      void loadJourneyResource(cacheKey, () => loaderRef.current(), {
        ttl,
        force: shouldBackgroundRefresh,
      }).catch(() => undefined);
    }
  }, [backgroundRefresh, cacheKey, enabled, staleTime, ttl]);

  const invalidate = useCallback(() => {
    if (!cacheKey) return;
    invalidateJourneyResource(cacheKey);
  }, [cacheKey]);

  return useMemo(
    () => ({
      ...snapshot,
      refresh,
      invalidate,
      prefetch: () => refresh(false),
    }),
    [invalidate, refresh, snapshot],
  );
}
