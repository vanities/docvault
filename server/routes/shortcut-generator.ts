// Apple Shortcuts `.shortcut` file generator — v10 (working).
//
// Produces a binary plist that:
//   1. Gets current date + formats as yyyy-MM-dd
//   2. Subtracts 1 day → yesterday (for the JSON date field)
//   3. Finds Health Samples for 8 metrics, filtered yesterday→today
//   4. Builds a JSON body as a Text action with .Value Aggrandizements
//   5. POSTs to the DocVault ingest endpoint with auth header
//   6. Shows result
//
// Action IDs are confirmed from decompiling a real shortcut on the user's
// Mac via Shortcuts.sqlite → plutil. The Text-based JSON approach avoids
// the Dictionary action crash that plagued earlier versions.
//
// The generated file must be:
//   1. Converted from bplist-creator output → XML plist (plutil -convert xml1)
//   2. Converted back to binary (plutil -convert binary1)
//   3. Signed (shortcuts sign --mode anyone)
// Steps 2-3 require macOS. The server endpoint serves unsigned files that
// may not import on iOS 15+ without the signing step.

import bplistCreator from 'bplist-creator';

interface ShortcutOptions {
  ingestUrl: string;
  authToken: string;
  personId: string;
  shortcutName?: string;
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
    .replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    })
    .toUpperCase();
}

const PH = '\uFFFC';

const METRICS = [
  { name: 'Steps', key: 'StepCount' },
  { name: 'Active Calories', key: 'ActiveEnergyBurned' },
  { name: 'Exercise Minutes', key: 'AppleExerciseTime' },
  { name: 'Walking + Running Distance', key: 'DistanceWalkingRunning' },
  { name: 'Flights Climbed', key: 'FlightsClimbed' },
  { name: 'Heart Rate', key: 'HeartRate' },
  { name: 'Resting Heart Rate', key: 'RestingHeartRate' },
  { name: 'Heart Rate Variability', key: 'HeartRateVariabilitySDNN' },
];

export function buildHealthShortcut(opts: ShortcutOptions): Buffer {
  const actions: Record<string, unknown>[] = [];

  // 1. Current Date
  const dateUuid = uuid();
  actions.push({
    WFWorkflowActionIdentifier: 'is.workflow.actions.date',
    WFWorkflowActionParameters: { UUID: dateUuid, WFDateActionMode: 'Current Date' },
  });

  // 2. Format today as yyyy-MM-dd
  const todayStrUuid = uuid();
  actions.push({
    WFWorkflowActionIdentifier: 'is.workflow.actions.format.date',
    WFWorkflowActionParameters: {
      UUID: todayStrUuid,
      WFDateFormat: 'yyyy-MM-dd',
      WFDateFormatStyle: 'Custom',
      WFISO8601IncludeTime: false,
      WFDate: {
        Value: {
          attachmentsByRange: {
            '{0, 1}': { OutputName: 'Current Date', OutputUUID: dateUuid, Type: 'ActionOutput' },
          },
          string: PH,
        },
        WFSerializationType: 'WFTextTokenString',
      },
    },
  });

  // 3. Adjust Date: subtract 86400 seconds (1 day) from Formatted Date
  const yesterdayUuid = uuid();
  actions.push({
    WFWorkflowActionIdentifier: 'is.workflow.actions.adjustdate',
    WFWorkflowActionParameters: {
      UUID: yesterdayUuid,
      WFAdjustOperation: 'Subtract',
      WFDate: {
        Value: {
          OutputName: 'Formatted Date',
          OutputUUID: todayStrUuid,
          Type: 'ActionOutput',
        },
        WFSerializationType: 'WFTextTokenAttachment',
      },
      WFDuration: {
        Value: { Unit: 4, Magnitude: 86400 },
        WFSerializationType: 'WFQuantityFieldValue',
      },
    },
  });

  // 4. Format yesterday as yyyy-MM-dd (for the JSON date field)
  const yesterdayStrUuid = uuid();
  actions.push({
    WFWorkflowActionIdentifier: 'is.workflow.actions.format.date',
    WFWorkflowActionParameters: {
      UUID: yesterdayStrUuid,
      WFDateFormat: 'yyyy-MM-dd',
      WFDateFormatStyle: 'Custom',
      WFISO8601IncludeTime: false,
      WFDate: {
        Value: {
          attachmentsByRange: {
            '{0, 1}': {
              OutputName: 'Adjusted Date',
              OutputUUID: yesterdayUuid,
              Type: 'ActionOutput',
            },
          },
          string: PH,
        },
        WFSerializationType: 'WFTextTokenString',
      },
    },
  });

  // 5. Find Health Samples × 8 — filtered yesterday→today
  const sampleUuids: Array<{ key: string; uuid: string }> = [];
  for (const m of METRICS) {
    const samplesUuid = uuid();
    actions.push({
      WFWorkflowActionIdentifier: 'is.workflow.actions.filter.health.quantity',
      WFWorkflowActionParameters: {
        UUID: samplesUuid,
        WFContentItemFilter: {
          Value: {
            WFActionParameterFilterPrefix: 1,
            WFContentPredicateBoundedDate: false,
            WFActionParameterFilterTemplates: [
              {
                Bounded: true,
                Operator: 4,
                Property: 'Type',
                Removable: false,
                Values: {
                  Enumeration: {
                    Value: m.name,
                    WFSerializationType: 'WFStringSubstitutableState',
                  },
                },
              },
              {
                Bounded: true,
                Operator: 1003,
                Property: 'Start Date',
                Removable: false,
                Values: {
                  Date: {
                    Value: {
                      OutputName: 'Current Date',
                      OutputUUID: dateUuid,
                      Type: 'ActionOutput',
                    },
                    WFSerializationType: 'WFTextTokenAttachment',
                  },
                  AnotherDate: {
                    Value: {
                      OutputName: 'Adjusted Date',
                      OutputUUID: yesterdayUuid,
                      Type: 'ActionOutput',
                    },
                    WFSerializationType: 'WFTextTokenAttachment',
                  },
                  Number: '1',
                  Unit: 16,
                },
              },
            ],
          },
          WFSerializationType: 'WFContentPredicateTableTemplate',
        },
        WFContentItemInputParameter: 'Library',
        WFContentItemLimitEnabled: false,
        WFContentItemSortOrder: 'Latest First',
        WFContentItemSortProperty: 'Start Date',
      },
    });
    sampleUuids.push({ key: m.key, uuid: samplesUuid });
  }

  // 6. Build JSON body as Text with variable interpolation + .Value Aggrandizements
  let template =
    '{\\n  "date": "' + PH + '",\\n  "source": "shortcut-v1",\\n  "raw": true,\\n  "metrics": {\\n';
  const refs: Array<{
    uuid: string;
    name: string;
    aggr: boolean;
  }> = [{ uuid: yesterdayStrUuid, name: 'Formatted Date', aggr: false }];

  for (let i = 0; i < sampleUuids.length; i++) {
    const s = sampleUuids[i];
    const comma = i < sampleUuids.length - 1 ? ',' : '';
    template += '    "' + s.key + '": "' + PH + '"' + comma + '\\n';
    refs.push({ uuid: s.uuid, name: 'Health Samples', aggr: true });
  }
  template += '  }\\n}';

  // Character offsets (not byte offsets!)
  const attachmentsByRange: Record<string, Record<string, unknown>> = {};
  let charOffset = 0;
  let refIndex = 0;
  for (let i = 0; i < template.length; i++) {
    if (template[i] === PH) {
      const ref = refs[refIndex];
      const attachment: Record<string, unknown> = {
        OutputName: ref.name,
        OutputUUID: ref.uuid,
        Type: 'ActionOutput',
      };
      if (ref.aggr) {
        attachment.Aggrandizements = [
          { PropertyName: 'Value', Type: 'WFPropertyVariableAggrandizement' },
        ];
      }
      attachmentsByRange[`{${charOffset}, 1}`] = attachment;
      refIndex++;
    }
    charOffset++;
  }

  const bodyUuid = uuid();
  actions.push({
    WFWorkflowActionIdentifier: 'is.workflow.actions.gettext',
    WFWorkflowActionParameters: {
      UUID: bodyUuid,
      WFTextActionText: {
        Value: { string: template, attachmentsByRange },
        WFSerializationType: 'WFTextTokenString',
      },
    },
  });

  // 7. POST to DocVault
  actions.push({
    WFWorkflowActionIdentifier: 'is.workflow.actions.downloadurl',
    WFWorkflowActionParameters: {
      WFURL: opts.ingestUrl,
      WFHTTPMethod: 'POST',
      WFHTTPBodyType: 'File',
      ShowHeaders: true,
      WFHTTPHeaders: {
        Value: {
          WFDictionaryFieldValueItems: [
            {
              WFItemType: 0,
              WFKey: {
                Value: { string: 'Content-Type' },
                WFSerializationType: 'WFTextTokenString',
              },
              WFValue: {
                Value: { string: 'application/json' },
                WFSerializationType: 'WFTextTokenString',
              },
            },
            {
              WFItemType: 0,
              WFKey: {
                Value: { string: 'X-Docvault-Auth' },
                WFSerializationType: 'WFTextTokenString',
              },
              WFValue: {
                Value: { string: opts.authToken },
                WFSerializationType: 'WFTextTokenString',
              },
            },
          ],
        },
        WFSerializationType: 'WFDictionaryFieldValue',
      },
      WFRequestVariable: {
        Value: {
          OutputName: 'Text',
          OutputUUID: bodyUuid,
          Type: 'ActionOutput',
        },
        WFSerializationType: 'WFTextTokenAttachment',
      },
    },
  });

  // 8. Show result
  actions.push({
    WFWorkflowActionIdentifier: 'is.workflow.actions.showresult',
    WFWorkflowActionParameters: { Text: 'DocVault sync complete' },
  });

  const workflow = {
    WFWorkflowClientVersion: '2607.0.4',
    WFWorkflowClientRelease: '2.2.2',
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowMinimumClientVersionString: '900',
    WFWorkflowName: opts.shortcutName ?? 'Sync Health → DocVault',
    WFWorkflowIcon: {
      WFWorkflowIconStartColor: 4282601983,
      WFWorkflowIconGlyphNumber: 59511,
    },
    WFWorkflowImportQuestions: [],
    WFWorkflowTypes: [],
    WFWorkflowInputContentItemClasses: ['WFStringContentItem'],
    WFWorkflowHasOutputFallback: false,
    WFWorkflowHasShortcutInputVariables: false,
    WFWorkflowActions: actions,
  };

  return bplistCreator(workflow);
}
