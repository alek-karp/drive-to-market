"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { WrapDesign } from "@/lib/types";

interface DesignPickerProps {
  designs: WrapDesign[];
  selectedId: string | null;
  onSelect: (design: WrapDesign) => void;
}

export function DesignPicker({
  designs,
  selectedId,
  onSelect,
}: DesignPickerProps) {
  if (designs.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Design options</CardTitle>
        <CardDescription>Choose the wrap to preview.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2">
          {designs.map((design) => {
            const selected = design.id === selectedId;
            return (
              <Button
                key={design.id}
                type="button"
                variant={selected ? "default" : "outline"}
                onClick={() => onSelect(design)}
                className="h-auto justify-start whitespace-normal"
              >
                <span
                  className="size-10 shrink-0 rounded-md border bg-cover bg-center"
                  style={{
                    backgroundColor: design.baseColor,
                    backgroundImage: design.graphics
                      ? `url(${design.graphics.decalUrl})`
                      : undefined,
                  }}
                />
                <span className="flex flex-col">
                  <span className="text-sm font-semibold text-card-foreground">
                    {design.style}
                  </span>
                  <span className="text-xs opacity-80">
                    {design.description}
                  </span>
                </span>
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
