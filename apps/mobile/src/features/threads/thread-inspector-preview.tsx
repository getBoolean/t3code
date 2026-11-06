// Fork: Subagent file previews stay on the inspector's stack until upstream scopes file navigation to its originating pane.
import {
  NavigationContainer,
  NavigationIndependentTree,
  useIsFocused,
  useNavigation,
  type StaticScreenProps,
  type NavigationState,
} from "@react-navigation/native";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { use, useState, type ReactNode } from "react";
import { Modal, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  FilePreviewCloseContext,
  FilePreviewExpandContext,
} from "../files/file-preview-presentation";

import { AppBar } from "../../components/ui/AppBar";
import { SheetHeader } from "../../components/ui/SheetHeader";
import { DevicePreviewScreen } from "../devices/DevicePreviewRouteScreen";
import { AttachmentFileScreen } from "../files/AttachmentFileScreen";
import { ThreadFileScreen, ThreadFilesTreeScreen } from "../files/ThreadFilesRouteScreen";
import { useMobileNavigationTheme } from "../../lib/useMobileNavigationTheme";
import { createV5StackNavigator } from "../../native/createV5StackNavigator";
import { WorkspaceSlotOptionsContext } from "../../native/v5-workspace-context";
import { AdaptiveWorkspaceContext } from "../layout/adaptive-workspace-context";
import { InspectorCloseContext } from "../layout/inspector-bar-store";
import { pageRoute } from "../layout/route-options";
import {
  WorkspaceContentWidthContext,
  WorkspaceSettledContentWidthContext,
} from "../layout/workspace-content-width";
import {
  ThreadInspectorNavigationContext,
  type ThreadInspectorTarget,
} from "./thread-inspector-navigation";

/** A thread shown outside its route: in the inspector pane, or presented full screen with a close. */
export type ThreadInspectorPresentation =
  | { readonly onMaximize: () => void }
  | { readonly onClose: () => void };

export function ThreadInspectorHeader(
  props: ThreadInspectorPresentation & { readonly title: string },
) {
  if ("onMaximize" in props) {
    return (
      <AppBar
        title={props.title}
        actions={[
          {
            accessibilityLabel: "Maximize thread",
            icon: "arrow.up.left.and.arrow.down.right",
            onPress: props.onMaximize,
          },
        ]}
      />
    );
  }
  return (
    <SheetHeader title={props.title} onClose={props.onClose} accessibilityLabel="Close thread" />
  );
}

const PreviewStack = createV5StackNavigator<
  {
    Thread: { readonly environmentId: string; readonly threadId: string };
  } & Pick<ReactNavigation.RootParamList, "ThreadAttachment" | "ThreadFile" | "ThreadFiles">
>();

// Fork: File drill-ins stay within the subagent pane without registering a replacement main inspector until upstream scopes inspector navigation.
function InspectorFileScope({ children }: { readonly children: ReactNode }) {
  const workspace = use(AdaptiveWorkspaceContext);
  return (
    <AdaptiveWorkspaceContext
      value={{
        ...workspace,
        layout: { ...workspace.layout, usesSplitView: false },
        fileInspector: { supported: false, width: null },
        sidebarToggleable: false,
      }}
    >
      {children}
    </AdaptiveWorkspaceContext>
  );
}

/** A thread shown beside or over the workspace does not take the workspace's content width. */
export function InspectorContentScope({ children }: { readonly children: ReactNode }) {
  return (
    <WorkspaceContentWidthContext value={null}>
      <WorkspaceSettledContentWidthContext value={null}>
        {children}
      </WorkspaceSettledContentWidthContext>
    </WorkspaceContentWidthContext>
  );
}

export function ThreadInspectorPreview(props: {
  readonly target: ThreadInspectorTarget;
  readonly onClose: () => void;
  readonly onOpen: (target: ThreadInspectorTarget) => void;
  readonly renderThread: (
    props: StaticScreenProps<{ readonly environmentId: string; readonly threadId: string }> & {
      readonly inspectorPresentation: ThreadInspectorPresentation;
    },
  ) => ReactNode;
}) {
  const navigation = useNavigation();
  const focused = useIsFocused();
  const theme = useMobileNavigationTheme();
  const insets = useSafeAreaInsets();
  const closeInspector = use(InspectorCloseContext);
  const { target } = props;
  const targetKey = `${target.environmentId}:${target.threadId}`;
  const [expandedTarget, setExpandedTarget] = useState<string | null>(null);
  const expanded = expandedTarget === targetKey;
  const [previewState, setPreviewState] = useState<{
    targetKey: string;
    state: NavigationState;
  } | null>(null);
  const localState = previewState?.targetKey === targetKey ? previewState.state : undefined;
  const maximizeDevice = (deviceKey: string | null) => {
    props.onOpen({ ...target, deviceKey: deviceKey ?? undefined });
    navigation.navigate("ThreadDevicePreview", {
      environmentId: target.environmentId,
      threadId: target.threadId,
      deviceKey: deviceKey ?? undefined,
    });
  };
  if (!focused) return null;
  // Fork: Reparent the file stack into a full-screen modal with its route state intact until upstream supports expanding inspector files.
  const presentFiles = (content: ReactNode) =>
    expanded ? (
      <Modal presentationStyle="fullScreen" visible onRequestClose={() => setExpandedTarget(null)}>
        <View
          className="flex-1 bg-screen"
          style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
        >
          {content}
        </View>
      </Modal>
    ) : (
      content
    );
  return (
    <ThreadInspectorNavigationContext value={props.onOpen}>
      <InspectorContentScope>
        {target.type === "device" ? (
          <DevicePreviewScreen
            key={`${target.environmentId}:${target.threadId}`}
            environmentId={EnvironmentId.make(target.environmentId)}
            threadId={ThreadId.make(target.threadId)}
            initialDeviceKey={target.deviceKey}
            onClose={props.onClose}
            onMaximize={maximizeDevice}
          />
        ) : (
          presentFiles(
            <View className="flex-1 bg-screen">
              <FilePreviewExpandContext
                value={expanded ? null : () => setExpandedTarget(targetKey)}
              >
                {/* Fork: Expanded files use their existing filename bar for dismissal until upstream supplies a single-bar inspector presentation. */}
                <FilePreviewCloseContext value={expanded ? () => setExpandedTarget(null) : null}>
                  {/* Fork: The local stack draws its own bars, so its screens skip the pane's bar slot, and the expanded modal has no inspector to close. */}
                  <WorkspaceSlotOptionsContext value={null}>
                    <InspectorCloseContext value={expanded ? null : closeInspector}>
                      <NavigationIndependentTree>
                        {/* Fork: Reset the state-owning container when changing subagents until upstream scopes independent navigation state by target. */}
                        <NavigationContainer
                          key={targetKey}
                          theme={theme}
                          initialState={localState}
                          onStateChange={(state) => {
                            if (state) setPreviewState({ targetKey, state });
                          }}
                          onUnhandledAction={navigation.dispatch}
                        >
                          <PreviewStack.Navigator
                            key={`${target.environmentId}:${target.threadId}`}
                            screenOptions={{
                              ...pageRoute(),
                              headerBackVisible: true,
                              headerShown: Platform.OS !== "android",
                            }}
                          >
                            <PreviewStack.Screen
                              name="Thread"
                              initialParams={target}
                              options={{ headerBackVisible: false }}
                            >
                              {(screen) =>
                                props.renderThread({
                                  route: screen.route,
                                  inspectorPresentation: expanded
                                    ? { onClose: () => setExpandedTarget(null) }
                                    : {
                                        onMaximize: () =>
                                          navigation.navigate("ThreadInspectorFullscreen", {
                                            environmentId: screen.route.params.environmentId,
                                            threadId: screen.route.params.threadId,
                                          }),
                                      },
                                })
                              }
                            </PreviewStack.Screen>
                            <PreviewStack.Screen name="ThreadAttachment">
                              {(screen) => (
                                <InspectorFileScope>
                                  <AttachmentFileScreen {...screen} />
                                </InspectorFileScope>
                              )}
                            </PreviewStack.Screen>
                            <PreviewStack.Screen name="ThreadFile">
                              {(screen) => (
                                <InspectorFileScope>
                                  <ThreadFileScreen {...screen} />
                                </InspectorFileScope>
                              )}
                            </PreviewStack.Screen>
                            <PreviewStack.Screen name="ThreadFiles">
                              {(screen) => (
                                <InspectorFileScope>
                                  <ThreadFilesTreeScreen {...screen} />
                                </InspectorFileScope>
                              )}
                            </PreviewStack.Screen>
                          </PreviewStack.Navigator>
                        </NavigationContainer>
                      </NavigationIndependentTree>
                    </InspectorCloseContext>
                  </WorkspaceSlotOptionsContext>
                </FilePreviewCloseContext>
              </FilePreviewExpandContext>
            </View>,
          )
        )}
      </InspectorContentScope>
    </ThreadInspectorNavigationContext>
  );
}
