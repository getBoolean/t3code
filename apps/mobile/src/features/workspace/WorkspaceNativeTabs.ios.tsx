import { IpadSidebarActions } from "./IpadSidebarActions";
import {
  WORKSPACE_TAB_LABELS,
  NAVIGATION_TAB_ICONS,
  useEnabledNavigationTabs,
} from "./navigation-tabs";
import { use, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { View, useWindowDimensions, type NativeSyntheticEvent } from "react-native";
import { Tabs, type TabSelectedEvent, type TabSelectionRejectedEvent } from "react-native-screens";

import { WorkspaceTabsContext, useWorkspaceTabs } from "./WorkspaceTabsContext";
import {
  NATIVE_WORKSPACE_TAB_SLOTS,
  workspaceTabForNativeSlot,
  workspaceUsesColumns,
  type WorkspaceTab,
} from "./workspace-tabs-state";
import {
  NativeWorkspaceTabActivityContext,
  WorkspaceSlotOptionsContext,
} from "../../native/v5-workspace-context";
import {
  useCompactWorkspaceTabs,
  useFloatingWorkspaceTabs,
  useSystemWorkspaceTabBar,
} from "./useSystemWorkspaceTabBar";
import { useControlTheme } from "../../components/ui/useControlTheme";
import { useDeviceType } from "../../native/native-layout-metrics";
import { WorkspaceSidebarTabs } from "./WorkspaceSidebarTabs";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { WorkspaceSidebarFooterContext } from "../layout/workspace-sidebar-footer";
import { useSelectWorkspaceTab } from "./useSelectWorkspaceTab";

const PULL_REQUEST_ICON = require("../../../assets/icons/pull-request.png");

/** Retain each native controller tree; removing its root can leave RNS's stack empty. */
function RetainedWorkspaceTab(props: {
  readonly tab: WorkspaceTab;
  readonly active: boolean;
  readonly children: ReactNode;
}) {
  const workspace = useWorkspaceTabs()!;
  // Whether this slot is the visible one, read by cleanups after the switch has committed.
  const activeRef = useRef(props.active);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes the committed active flag to a ref that header cleanups read after the tab switch commits
  useLayoutEffect(() => {
    activeRef.current = props.active;
  }, [props.active]);
  const isActive = () => activeRef.current;
  const activity = {
    active: props.active,
    isActive,
  };
  const [optionsByRoute, setOptionsByRoute] = useState<ReadonlyMap<string, object>>(new Map());
  // Stable, so writers and the cleanups that depend on them don't re-run on every write.
  const setRouteOptions = (routeKey: string, options: object) =>
    setOptionsByRoute((current) =>
      new Map(current).set(routeKey, { ...current.get(routeKey), ...options }),
    );
  const slotOptions = { byRoute: optionsByRoute, set: setRouteOptions };
  const [content, setContent] = useState(
    props.active ? { workspace, children: props.children } : null,
  );
  if (props.active && (content?.workspace !== workspace || content?.children !== props.children))
    setContent({ workspace, children: props.children });
  return content ? (
    <NativeWorkspaceTabActivityContext value={activity}>
      <WorkspaceSlotOptionsContext value={slotOptions}>
        <WorkspaceTabsContext value={content.workspace}>{content.children}</WorkspaceTabsContext>
      </WorkspaceSlotOptionsContext>
    </NativeWorkspaceTabActivityContext>
  ) : null;
}

export function WorkspaceNativeTabs(props: {
  readonly children: ReactNode;
  readonly hidden: boolean;
  /** The sidebar column draws the tabs itself, so they leave with it. */
  readonly tabsInSidebarColumn?: boolean;
}) {
  const workspace = useWorkspaceTabs()!;
  const order = useEnabledNavigationTabs();
  const primaryTabs = order.slice(0, 4);
  const overflow = order[4];
  const selectTab = useSelectWorkspaceTab();
  const [provenance, setProvenance] = useState(0);
  const systemTabBar = useSystemWorkspaceTabBar();
  const deviceType = useDeviceType();
  const compactTabs = useCompactWorkspaceTabs();
  const { layout, panes } = useAdaptiveWorkspaceLayout();
  // The tabs belong to the sidebar; over a page with the sidebar hidden they'd cover the composer.
  const hiddenWithSidebar =
    deviceType === "pad" &&
    layout.usesSplitView &&
    workspaceUsesColumns(workspace.state.selectedTab, workspace.settingsOpen) &&
    !panes.primarySidebarVisible;
  const { width } = useWindowDimensions();
  const { colors } = useControlTheme();
  const selectedTab = workspace.state.selectedTab;
  const selectedSlot = workspace.settingsOpen ? -1 : primaryTabs.indexOf(selectedTab);
  const request = {
    selectedScreenKey: selectedSlot === -1 ? "settings" : NATIVE_WORKSPACE_TAB_SLOTS[selectedSlot]!,
    baseProvenance: provenance,
  };
  // Fork: before iOS 26 this navigator sits beside a JS sidebar, so left: 0 here is past the
  // sidebar's edge, over the thread composer. Draw the bar at the sidebar's foot instead.
  const sidebarFooter = use(WorkspaceSidebarFooterContext);
  const showSidebarTabs =
    (deviceType === "pad" ||
      compactTabs ||
      (layout.variant === "medium" &&
        !workspaceUsesColumns(selectedTab, workspace.settingsOpen))) &&
    deviceType !== "pad" &&
    !props.hidden &&
    !props.tabsInSidebarColumn &&
    !hiddenWithSidebar;
  const sidebarTabs = showSidebarTabs ? (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        bottom: 0,
        // UIKit can shrink the sidebar to 280pt independently of its preferred width.
        // In the sidebar slot the bar spans the column instead of that capped overlay.
        width: layout.listPaneWidth ?? width,
        height: 128,
      }}
    >
      <WorkspaceSidebarTabsFooter />
    </View>
  ) : null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- projects the tab bar into the sidebar column's slot, which renders outside this tree
  useEffect(() => {
    sidebarFooter?.set(
      sidebarTabs ? (
        <WorkspaceTabsContext value={workspace}>{sidebarTabs}</WorkspaceTabsContext>
      ) : null,
    );
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the sidebar slot when this navigator unmounts or the sidebar column goes away
  useEffect(() => () => sidebarFooter?.set(null), [sidebarFooter]);
  if (deviceType === "pad") return <View style={{ flex: 1 }}>{props.children}</View>;
  return (
    <View style={{ flex: 1 }}>
      <Tabs.Host
        navStateRequest={request}
        tabBarHidden={props.hidden || !systemTabBar}
        ios={{
          tabBarControllerMode: "tabBar",
          tabBarMinimizeBehavior: "never",
          tabBarTintColor: colors["--color-primary"],
        }}
        onTabSelectionRejected={({
          nativeEvent,
        }: NativeSyntheticEvent<TabSelectionRejectedEvent>) =>
          setProvenance(nativeEvent.provenance)
        }
        onTabSelected={({ nativeEvent }: NativeSyntheticEvent<TabSelectedEvent>) => {
          setProvenance(nativeEvent.provenance);
          if (nativeEvent.actionOrigin === "programmatic-js") return;
          const tab = workspaceTabForNativeSlot(primaryTabs, nativeEvent.selectedScreenKey);
          if (tab) selectTab(tab);
        }}
      >
        {NATIVE_WORKSPACE_TAB_SLOTS.map((slot, index) => {
          const settings = slot === "settings";
          const tab = settings ? (overflow ?? selectedTab) : primaryTabs[index];
          if (!tab) return null;
          return (
            <Tabs.Screen
              // Stable slot controllers keep UIKit's stacks attached when a section moves into Settings.
              key={slot}
              screenKey={slot}
              title=""
              tabBarItemAccessibilityLabel={settings ? "Settings" : WORKSPACE_TAB_LABELS[tab]}
              ios={{
                icon: settings
                  ? { type: "sfSymbol", name: "gearshape" }
                  : tab === "pullRequests"
                    ? { type: "templateSource", templateSource: PULL_REQUEST_ICON }
                    : { type: "sfSymbol", name: NAVIGATION_TAB_ICONS[tab] },
                selectedIcon:
                  !settings && tab === "threads"
                    ? { type: "sfSymbol", name: "text.bubble.fill" }
                    : undefined,
                overrideScrollViewContentInsetAdjustmentBehavior: false,
              }}
            >
              <RetainedWorkspaceTab
                tab={tab}
                active={settings ? selectedSlot === -1 : selectedSlot === index}
              >
                {props.children}
              </RetainedWorkspaceTab>
            </Tabs.Screen>
          );
        })}
      </Tabs.Host>
      {sidebarFooter ? null : sidebarTabs}
    </View>
  );
}

/** The workspace tabs at the foot of the sidebar. */
export function WorkspaceSidebarTabsFooter() {
  const workspace = useWorkspaceTabs()!;
  const { startNewTask } = useAdaptiveWorkspaceLayout();
  const compact = useFloatingWorkspaceTabs();
  const deviceType = useDeviceType();
  if (deviceType === "pad") return <IpadSidebarActions />;
  return (
    <WorkspaceSidebarTabs
      compact={compact}
      reserveComposeSpace={compact}
      onNewTask={
        compact && !workspace.settingsOpen && workspace.state.selectedTab === "threads"
          ? startNewTask
          : undefined
      }
    />
  );
}
