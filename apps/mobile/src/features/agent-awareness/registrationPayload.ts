import type { RelayDeviceRegistrationRequest } from "@t3tools/contracts/relay";

import type { Preferences } from "../../persistence/mobile-preferences";
import { supportsAgentAwarenessPush } from "./capabilities";

// Fork: the app supports iOS 17, but the hosted relay rejects versions below 18 and only stores the value.
const HOSTED_RELAY_MIN_IOS_MAJOR = 18;

// Development builds use sandbox APNs; distribution builds use production APNs.
export function resolveApsEnvironment(appVariant: unknown): "sandbox" | "production" {
  return appVariant === "development" ? "sandbox" : "production";
}

export function makeRelayDeviceRegistrationRequest(
  input: {
    readonly deviceId: string;
    readonly label: string;
    readonly appVersion?: string;
    readonly bundleId?: string;
    readonly apsEnvironment?: "sandbox" | "production";
    readonly pushToken?: string;
    readonly pushToStartToken?: string;
    readonly notificationsEnabled: boolean;
    readonly preferences: Preferences;
  } & (
    | { readonly platform?: "ios"; readonly iosMajorVersion: number }
    | {
        readonly platform: "android";
        readonly androidApiLevel: number;
        readonly notificationPermissionGranted: boolean;
      }
  ),
): RelayDeviceRegistrationRequest {
  const pushAvailable = supportsAgentAwarenessPush();
  const liveActivitiesEnabled =
    pushAvailable &&
    input.preferences.liveActivitiesEnabled !== false &&
    (input.platform !== "android" ||
      (input.notificationPermissionGranted && Boolean(input.pushToken)));
  return {
    deviceId: input.deviceId,
    label: input.label,
    platform: input.platform ?? "ios",
    ...(input.platform === "android"
      ? { androidApiLevel: input.androidApiLevel }
      : { iosMajorVersion: Math.max(input.iosMajorVersion, HOSTED_RELAY_MIN_IOS_MAJOR) }),
    appVersion: input.appVersion,
    ...(input.bundleId ? { bundleId: input.bundleId } : {}),
    ...(input.apsEnvironment ? { apsEnvironment: input.apsEnvironment } : {}),
    ...(input.pushToken ? { pushToken: input.pushToken } : {}),
    ...(input.pushToStartToken ? { pushToStartToken: input.pushToStartToken } : {}),
    preferences: {
      liveActivitiesEnabled,
      notificationsEnabled: pushAvailable && input.notificationsEnabled,
      notifyOnApproval: true,
      notifyOnInput: true,
      notifyOnCompletion: true,
      notifyOnFailure: true,
    },
  };
}
