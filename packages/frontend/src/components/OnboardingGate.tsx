/**
 * OnboardingGate — mounts the first-login onboarding modal.
 * Remounts when the profile is completed so other components can pick it up.
 */

"use client";

import { useState } from "react";
import { OnboardingModal } from "./OnboardingModal";

export function OnboardingGate() {
  const [, setCompleted] = useState(false);
  return <OnboardingModal onDone={() => setCompleted(true)} />;
}
