import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

export function useFetch<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!url);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!url) return;
    const mySeq = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const d = await api.get<T>(url);
      if (mySeq === seq.current) setData(d);
    } catch (e) {
      if (mySeq === seq.current) setError((e as Error).message);
    } finally {
      if (mySeq === seq.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, error, loading, reload: load };
}
