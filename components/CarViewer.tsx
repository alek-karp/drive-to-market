"use client";

import { OrbitControls, Stage } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { ListIcon, XIcon } from "lucide-react";
import { Suspense, useState } from "react";
import { CarModel } from "@/components/CarModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CATEGORY_LABELS, type CarPartCategory } from "@/lib/carModel";
import type { WrapDesign } from "@/lib/types";

interface CarViewerProps {
  /** The selected wrap concept painted onto the car body, or null for stock paint. */
  design?: WrapDesign | null;
}

/**
 * Stage 2/3 deliverable: the prepared car.glb loaded in the browser with
 * individually targetable parts. Click a surface (or a legend chip) to
 * highlight every mesh in that category. The selected design's graphics are
 * painted onto the body meshes.
 */
export function CarViewer({ design }: CarViewerProps) {
  const [parts, setParts] = useState<CarPartCategory[]>([]);
  const [selected, setSelected] = useState<CarPartCategory | null>(null);
  const [partsOpen, setPartsOpen] = useState(false);

  function toggle(category: CarPartCategory) {
    setSelected((current) => (current === category ? null : category));
  }

  return (
    <div className="relative h-full w-full">
      <Canvas
        shadows="variance"
        camera={{ position: [4, 2.5, 5], fov: 45 }}
        className="h-full w-full"
        onPointerMissed={() => setSelected(null)}
      >
        <color attach="background" args={["#18181b"]} />
        <Suspense fallback={null}>
          <Stage environment="city" intensity={0.5} adjustCamera={1.4}>
            <CarModel
              design={design}
              highlight={selected}
              onPartsReady={setParts}
              onSelect={toggle}
            />
          </Stage>
        </Suspense>
        <OrbitControls
          makeDefault
          enablePan={false}
          minDistance={2}
          maxDistance={14}
          maxPolarAngle={Math.PI / 2}
        />
      </Canvas>

      {parts.length > 0 && (
        <PartLegend
          parts={parts}
          selected={selected}
          open={partsOpen}
          onOpenChange={setPartsOpen}
          onToggle={toggle}
        />
      )}
    </div>
  );
}

function PartLegend({
  parts,
  selected,
  open,
  onOpenChange,
  onToggle,
}: {
  parts: CarPartCategory[];
  selected: CarPartCategory | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggle: (category: CarPartCategory) => void;
}) {
  return (
    <div className="absolute right-3 top-3 z-10 flex max-w-sm flex-col items-end gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-expanded={open}
        aria-controls="parts-legend"
        onClick={() => onOpenChange(!open)}
        className="bg-card/80 shadow-xs backdrop-blur"
      >
        <ListIcon data-icon="inline-start" />
        Parts <Badge variant="secondary">{parts.length}</Badge>
      </Button>

      {open && (
        <Card
          id="parts-legend"
          size="sm"
          className="w-[min(22rem,calc(100vw-1.5rem))] bg-card/80 backdrop-blur"
        >
          <CardHeader>
            <CardTitle>
              Parts <Badge variant="secondary">{parts.length}</Badge>
            </CardTitle>
            <CardAction>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Close parts"
                onClick={() => onOpenChange(false)}
              >
                <XIcon />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {parts.map((category) => {
                const active = category === selected;
                return (
                  <Button
                    key={category}
                    type="button"
                    size="xs"
                    variant={active ? "default" : "secondary"}
                    onClick={() => onToggle(category)}
                  >
                    {CATEGORY_LABELS[category]}
                  </Button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
