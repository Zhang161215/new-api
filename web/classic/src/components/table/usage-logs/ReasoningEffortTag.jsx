import React from 'react';
import { Tooltip } from '@douyinfe/semi-ui';

const EFFORT_LETTER = {
  none: 'n',
  minimal: 'm',
  low: 'l',
  medium: 'm',
  high: 'h',
  xhigh: 'x',
  max: 'm',
};

const EFFORT_TONE = {
  none: 'grey',
  minimal: 'grey',
  low: 'cyan',
  medium: 'blue',
  high: 'orange',
  xhigh: 'purple',
  max: 'violet',
};

export function reasoningEffortLetter(effort) {
  const key = String(effort || '').toLowerCase();
  if (EFFORT_LETTER[key]) {
    return EFFORT_LETTER[key];
  }
  return key.charAt(0) || '?';
}

export function renderReasoningEffortTag(other) {
  const effort = other?.reasoning_effort;
  if (!effort) {
    return null;
  }
  const full = String(effort).toLowerCase();
  const letter = reasoningEffortLetter(full);
  const tone = EFFORT_TONE[full] || 'grey';

  return (
    <Tooltip content={full}>
      <span className={`reasoning-effort-tag reasoning-effort-tag-${tone}`}>
        <i>{letter}</i>
      </span>
    </Tooltip>
  );
}
