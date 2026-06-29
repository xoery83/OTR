"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  currencyDefinitions,
  findCurrencyMatch,
  getCurrencySuggestions,
  normalizeCurrencyCode,
} from "@/lib/currencies";

type CurrencyComboboxProps = {
  value: string;
  onChange: (currency: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

function displayForCurrency(code: string) {
  const normalized = normalizeCurrencyCode(code);
  const currency = currencyDefinitions.find((item) => item.code === normalized);
  if (!currency) return normalized;
  return `${currency.code} · ${currency.zhName}`;
}

export function CurrencyCombobox({
  value,
  onChange,
  label,
  placeholder = "NZD / 新西兰元",
  disabled = false,
  className = "",
}: CurrencyComboboxProps) {
  const [draft, setDraft] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const query = isEditing ? draft : displayForCurrency(value);
  const suggestions = useMemo(() => getCurrencySuggestions(query), [query]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function commit(nextQuery = query) {
    const match = findCurrencyMatch(nextQuery) ?? findCurrencyMatch(value);
    const code = match?.code ?? normalizeCurrencyCode(nextQuery);
    if (code) {
      onChange(code);
    }
    setIsEditing(false);
    setIsOpen(false);
  }

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      {label ? (
        <label className="mb-1 block text-sm font-bold text-stone-800">
          {label}
        </label>
      ) : null}
      <input
        value={query}
        disabled={disabled}
        onFocus={() => {
          setDraft(displayForCurrency(value));
          setIsEditing(true);
          setIsOpen(true);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          setIsOpen(true);
        }}
        onBlur={() => commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            setIsOpen(false);
          }
        }}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-stone-950 outline-none focus:border-emerald-300 disabled:bg-stone-100 disabled:text-stone-400"
      />
      {isOpen && !disabled ? (
        <div className="absolute z-30 mt-2 max-h-72 w-full overflow-auto rounded-2xl border border-stone-200 bg-white p-1 shadow-xl">
          {suggestions.map((currency) => (
            <button
              key={currency.code}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(currency.code);
                setIsEditing(false);
                setIsOpen(false);
              }}
              className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left hover:bg-emerald-50"
            >
              <span>
                <span className="font-black text-stone-950">
                  {currency.code}
                </span>
                <span className="ml-2 text-sm text-stone-600">
                  {currency.zhName}
                </span>
              </span>
              <span className="text-xs text-stone-400">{currency.symbol}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
