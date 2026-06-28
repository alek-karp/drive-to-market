"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Stage 9 (animated city drive-through) lives here. Stage 1 placeholder:
 * a simple overlay so the "City Demo" affordance exists end to end.
 */
export function CityScene({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/95 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>City demo</CardTitle>
          <CardDescription>
            The animated city drive-through is built in Stage 9. This is a
            placeholder.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Back to preview
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
