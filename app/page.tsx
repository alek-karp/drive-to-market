"use client";

import { CheckIcon, CircleIcon, EyeIcon, LoaderCircleIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useState } from "react";
import { CityScene } from "@/components/CityScene";
import { DesignPicker } from "@/components/DesignPicker";
import { ModeToggle } from "@/components/mode-toggle";
import { UrlInput } from "@/components/UrlInput";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import type { BrandProfile, WrapDesign } from "@/lib/types";

// Canvas touches browser-only APIs — keep it out of the server render.
const CarViewer = dynamic(
  () => import("@/components/CarViewer").then((m) => m.CarViewer),
  {
    ssr: false,
    loading: () => <ViewerFallback label="Loading viewer…" />,
  },
);

const loadingSteps = [
  "Reading website",
  "Extracting brand strategy",
  "Generating AI ad candidates",
  "Applying design to car",
  "Preparing 3D preview",
] as const;

type Status = "idle" | "loading" | "ready" | "error";

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [brand, setBrand] = useState<BrandProfile | null>(null);
  const [designs, setDesigns] = useState<WrapDesign[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCity, setShowCity] = useState(false);

  const selectedDesign = designs.find((d) => d.id === selectedId) ?? null;

  async function handleSubmit(url: string) {
    setStatus("loading");
    setError(null);
    setStepIndex(0);
    setBrand(null);
    setDesigns([]);
    setSelectedId(null);

    try {
      // Stage 4: URL -> brand profile.
      const brandRes = await postJson("/api/process-url", { url });
      const nextBrand = brandRes.brand as BrandProfile;
      setBrand(nextBrand);
      setStepIndex(1);
      await delay(400);

      // Stage 5: brand -> Grok-generated ad background with our controlled
      // company-name layer composited after generation.
      setStepIndex(2);
      const adRes = await postJson("/api/generate-ad", { brand: nextBrand });
      const aiDesign = adRes.design as WrapDesign;
      setDesigns([aiDesign]);

      // Stage 6: compose per-part textures, blending the ad over the base coat.
      setStepIndex(3);
      const composeRes = await postJson("/api/compose-textures", {
        design: aiDesign,
        brand: nextBrand,
      });
      const composedDesign = {
        ...aiDesign,
        graphics: composeRes.graphics as WrapDesign["graphics"],
        textures: composeRes.textures as WrapDesign["textures"],
      };
      setDesigns([composedDesign]);
      setSelectedId(composedDesign.id);
      await delay(400);

      setStepIndex(4);
      await delay(400);

      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setStatus("error");
    }
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      {/* Left: controls + brand info + designs */}
      <aside className="flex h-full min-h-0 w-full max-w-sm shrink-0 flex-col overflow-hidden border-r border-border">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6">
          <div className="flex flex-col gap-6">
            <header className="flex shrink-0 items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold tracking-tight">
                  Wrap Studio
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Brand any car from any website.
                </p>
              </div>
              <ModeToggle />
            </header>

            {status !== "ready" && (
              <>
                <Card size="sm">
                  <CardHeader>
                    <CardTitle>Ad pipeline</CardTitle>
                    <CardDescription>
                      Extracts strategy, generates multiple AI backgrounds,
                      ranks candidates, and overlays readable copy
                      deterministically.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-1.5">
                      {["Strategy", "4 candidates", "Ranked", "Composited"].map(
                        (item) => (
                          <Badge key={item} variant="secondary">
                            {item}
                          </Badge>
                        ),
                      )}
                    </div>
                  </CardContent>
                </Card>

                <UrlInput
                  onSubmit={handleSubmit}
                  disabled={status === "loading"}
                />
              </>
            )}

            {status === "loading" && <LoadingSteps activeIndex={stepIndex} />}

            {status === "error" && error && (
              <Alert variant="destructive">
                <AlertTitle>Unable to generate wrap</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {brand && status !== "loading" && (
              <Card>
                <CardHeader>
                  <CardTitle>{brand.name}</CardTitle>
                  <CardDescription>{brand.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex gap-1.5">
                      {brand.colors.map((c) => (
                        <span
                          key={c}
                          title={c}
                          className="size-5 rounded border border-border"
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                    <div className="space-y-2 text-sm">
                      <ProfileFact label="Audience" value={brand.audience} />
                      <ProfileFact label="Offer" value={brand.offer} />
                      <ProfileFact label="CTA" value={brand.requiredCta} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {status === "ready" && (
              <>
                <DesignPicker
                  designs={designs}
                  selectedId={selectedId}
                  onSelect={(d) => setSelectedId(d.id)}
                />
                <GeneratedAssetsSection design={selectedDesign} />
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Right: 3D preview + city demo */}
      <main className="relative flex min-h-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          {status === "ready" ? (
            <CarViewer design={selectedDesign} />
          ) : (
            <ViewerFallback
              label={
                status === "loading"
                  ? "Building preview…"
                  : "Enter a website URL to generate a branded car"
              }
            />
          )}
          {showCity && <CityScene onClose={() => setShowCity(false)} />}
        </div>

        <div className="flex shrink-0 items-center justify-center gap-2 border-t border-border p-4">
          <Dialog>
            <DialogTrigger asChild>
              <Button type="button" disabled={!selectedDesign}>
                <EyeIcon data-icon="inline-start" />
                Preview Ad
              </Button>
            </DialogTrigger>
            {selectedDesign && (
              <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                  <DialogTitle>{selectedDesign.style} ad preview</DialogTitle>
                  <DialogDescription>
                    Source graphic used for the selected car wrap.
                  </DialogDescription>
                </DialogHeader>
                <div className="overflow-hidden rounded-lg border border-border bg-muted">
                  <Image
                    src={selectedDesign.graphics.decalUrl}
                    alt={`${selectedDesign.style} generated ad`}
                    width={1024}
                    height={576}
                    unoptimized
                    className="h-auto w-full"
                  />
                </div>
              </DialogContent>
            )}
          </Dialog>

          <Button
            type="button"
            disabled={status !== "ready"}
            onClick={() => setShowCity(true)}
          >
            City Demo
          </Button>
        </div>
      </main>
    </div>
  );
}

function LoadingSteps({ activeIndex }: { activeIndex: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Generating wrap</CardTitle>
        <CardDescription>{loadingSteps[activeIndex]}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Progress value={((activeIndex + 1) / loadingSteps.length) * 100} />
        <ol className="flex flex-col gap-2">
          {loadingSteps.map((label, i) => {
            const state =
              i < activeIndex
                ? "done"
                : i === activeIndex
                  ? "active"
                  : "pending";
            return (
              <li
                key={label}
                className="flex items-center gap-2 text-sm"
                aria-current={state === "active"}
              >
                <Badge
                  variant={state === "active" ? "default" : "secondary"}
                  className="w-7"
                >
                  {state === "done" ? (
                    <CheckIcon data-icon="inline-start" />
                  ) : state === "active" ? (
                    <LoaderCircleIcon
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : (
                    <CircleIcon data-icon="inline-start" />
                  )}
                </Badge>
                <span
                  className={
                    state === "pending" ? "text-muted-foreground" : undefined
                  }
                >
                  {label}
                  {state === "active" ? "…" : ""}
                </span>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

function ViewerFallback({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>{label}</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="aspect-video w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

function ProfileFact({ label, value }: { label: string; value: string }) {
  if (!value) return null;

  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p>{value}</p>
    </div>
  );
}

function GeneratedAssetsSection({ design }: { design: WrapDesign | null }) {
  if (!design) return null;

  const assets = buildAssetList(design);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generated assets</CardTitle>
        <CardDescription>
          Files produced for the selected wrap concept.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {assets.map((asset) => (
            <div
              key={asset.key}
              className="overflow-hidden rounded-lg border border-border bg-muted"
            >
              <Image
                src={asset.url}
                alt={asset.label}
                width={512}
                height={384}
                unoptimized
                className="h-auto w-full"
              />
              <div className="space-y-1 border-t border-border bg-card px-3 py-2">
                <p className="text-sm font-medium">{asset.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {asset.path}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function buildAssetList(design: WrapDesign) {
  const seen = new Set<string>();
  const assets: Array<{
    key: string;
    label: string;
    path: string;
    url: string;
  }> = [];

  const pushAsset = (key: string, label: string, url?: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    assets.push({
      key,
      label,
      url,
      path: url.replace(/^\//, ""),
    });
  };

  pushAsset(`${design.id}-decal`, "Decal graphic", design.graphics.decalUrl);
  pushAsset(
    `${design.id}-pattern`,
    "Pattern texture",
    design.graphics.patternUrl,
  );
  pushAsset(
    `${design.id}-pattern-svg`,
    "Pattern SVG",
    design.graphics.patternUrl.replace(
      /pattern\.png(\?.*)?$/i,
      "pattern.svg$1",
    ),
  );
  pushAsset(`${design.id}-hood`, "Hood logo graphic", design.graphics.hoodUrl);
  pushAsset(
    `${design.id}-trunk`,
    design.graphics.trunkCta
      ? `Trunk CTA: ${design.graphics.trunkCta}`
      : "Trunk CTA graphic",
    design.graphics.trunkUrl,
  );

  Object.entries(design.textures).forEach(([part, url]) => {
    pushAsset(`${design.id}-${part}`, formatPartLabel(part), url);
  });

  return assets;
}

function formatPartLabel(part: string) {
  return part
    .split("_")
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join(" ");
}

async function postJson(
  url: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(
      (detail as { error?: string } | null)?.error ??
        `Request to ${url} failed (${res.status})`,
    );
  }
  return res.json();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
