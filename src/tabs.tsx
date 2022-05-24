'use strict';

import { h, ComponentChildren, toChildArray, VNode } from 'preact';

export interface TabProps {
  labels: string[];
  disabledLabels?: string[];
  rightOfTabs?: VNode;
  selected: string;
  chooseTab: (label: string) => void;
  children: ComponentChildren;
}

export const TabView = (props: TabProps) => {
  const selected = props.selected;
  const disabled = new Set(props.disabledLabels ?? []);
  const labels = props.labels;
  const children = toChildArray(props.children);

  const renderTab = (label: string) => {
    if (disabled.has(label)) {
      return <li class="pure-menu-item pure-menu-disabled"><a class="pure-menu-link">{label}</a></li>
    }

    let classes = "pure-menu-item";
    if (label == selected) classes += " pure-menu-selected";

    return <li class={classes}>
      <a href="#" class="pure-menu-link" onClick={() => props.chooseTab(label)}
      >{label}</a>
    </li>
  }

  return <div class="tab-view">
    <div class="tab-row">
      <div class="pure-menu pure-menu-horizontal"><ul class="pure-menu-list">
        {labels.map(renderTab)}
      </ul>
      </div>
      {(props.rightOfTabs ? <div class="right-of-tabs">{props.rightOfTabs}</div> : "")}
    </div>
    {children.map((child, i) => {
      if (labels[i] == selected) {
        return <div class="tab-view-selected">{child}</div>
      }
    })}
  </div>
}
