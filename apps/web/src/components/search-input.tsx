"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export default function SearchInput({
  placeholder = "Buscar…",
  paramName = "q",
  debounceMs = 400,
}: {
  placeholder?: string;
  paramName?: string;
  debounceMs?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get(paramName) ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setValue(searchParams.get(paramName) ?? "");
  }, [searchParams, paramName]);

  function push(term: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (term) {
      params.set(paramName, term);
    } else {
      params.delete(paramName);
    }
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setValue(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => push(v), debounceMs);
  }

  return (
    <input
      type="search"
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      className="w-full rounded-lg border border-control bg-surface-raised px-4 py-2.5 text-sm text-fg placeholder:text-fg-subtle outline-none transition focus:border-focus focus:ring-1 focus:ring-focus sm:max-w-sm"
    />
  );
}
