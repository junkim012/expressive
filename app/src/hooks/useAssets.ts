"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchAssets } from "@/lib/api";
import type { AssetInfo } from "@/types";

export function useAssets() {
  return useQuery({
    queryKey: ["assets"],
    queryFn: fetchAssets,
    staleTime: Infinity,
    retry: 3,
  });
}

export function useAssetByAddress(
  assets: AssetInfo[] | undefined,
  address: string | undefined
): AssetInfo | undefined {
  if (!assets || !address) return undefined;
  return assets.find((a) => a.address.toLowerCase() === address.toLowerCase());
}
