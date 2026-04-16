// Apple Shortcuts `.shortcut` file generator — v2.
//
// Rebuilt from decompiled ground truth: the "Health Data Export" shortcut
// from Heartbridge (mm/heartbridge) was extracted from the local macOS
// Shortcuts.sqlite database and inspected with plutil. Every action ID
// and parameter structure below is copied from a KNOWN WORKING shortcut,
// not guessed from documentation.
//
// Action IDs confirmed from the real shortcut:
//   - is.workflow.actions.filter.health.quantity  (NOT findhealthsamples)
//   - is.workflow.actions.properties.health.quantity
//   - is.workflow.actions.calculatestatistics
//   - is.workflow.actions.format.date  (NOT formatdate)
//   - is.workflow.actions.dictionary
//   - is.workflow.actions.setvalueforkey
//   - is.workflow.actions.downloadurl
//   - is.workflow.actions.gettext
//   - is.workflow.actions.date
//   - is.workflow.actions.showresult

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

// Placeholder character for variable references in text strings
const PH = '\uFFFC';

// ---------------------------------------------------------------------------
// Action builders — all modeled after the decompiled Heartbridge shortcut
// ---------------------------------------------------------------------------

function commentAction(text: string) {
  return {
    WFWorkflowActionIdentifier: 'is.workflow.actions.comment',
    WFWorkflowActionParameters: { WFCommentActionText: text },
  };
}

function dateAction(outputUuid: string) {
  return {
    WFWorkflowActionIdentifier: 'is.workflow.actions.date',
    WFWorkflowActionParameters: {
      UUID: outputUuid,
      WFDateActionMode: 'Current Date',
    },
  };
}

function formatDateAction(inputUuid: string, inputName: string, outputUuid: string) {
  return {
    WFWorkflowActionIdentifier: 'is.workflow.actions.format.date',
    WFWorkflowActionParameters: {
      UUID: outputUuid,
      WFDateFormat: 'yyyy-MM-dd',
      WFDateFormatStyle: 'Custom',
      WFISO8601IncludeTime: false,
      WFDate: {
        Value: {
          attachmentsByRange: {
            '{0, 1}': {
              OutputName: inputName,
              OutputUUID: inputUuid,
              Type: 'ActionOutput',
            },
          },
          string: PH,
        },
        WFSerializationType: 'WFTextTokenString',
      },
    },
  };
}

/**
 * Find Health Samples — the REAL action ID is filter.health.quantity.
 * Uses a content filter to select samples by Type, filtered to "today".
 */
function findHealthSamplesAction(healthTypeName: string, outputUuid: string) {
  return {
    WFWorkflowActionIdentifier: 'is.workflow.actions.filter.health.quantity',
    WFWorkflowActionParameters: {
      UUID: outputUuid,
      WFContentItemFilter: {
        Value: {
          WFActionParameterFilterPrefix: 1,
          WFContentPredicateBoundedDate: false,
          WFActionParameterFilterTemplates: [
            {
              Bounded: true,
              Operator: 4, // "is"
              Property: 'Type',
              Removable: false,
              Values: {
                Enumeration: {
                  Value: healthTypeName,
                  WFSerializationType: 'WFStringSubstitutableState',
                },
              },
            },
            {
              Bounded: true,
              Operator: 4, // "is today"
              Property: 'Start Date',
              Removable: false,
              Values: {
                Date: {
                  Value: { Type: 'CurrentDate' },
                  WFSerializationType: 'WFTextTokenAttachment',
                },
              },
              Unit: 4, // day
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
  };
}

/**
 * Calculate Statistics — sum, average, etc. on a list of health samples.
 */
function calculateStatisticsAction(
  inputUuid: string,
  inputName: string,
  operation: string,
  outputUuid: string
) {
  return {
    WFWorkflowActionIdentifier: 'is.workflow.actions.calculatestatistics',
    WFWorkflowActionParameters: {
      UUID: outputUuid,
      WFStatisticsOperation: operation,
      WFInput: {
        Value: {
          OutputName: inputName,
          OutputUUID: inputUuid,
          Type: 'ActionOutput',
        },
        WFSerializationType: 'WFTextTokenAttachment',
      },
    },
  };
}

/** Build a dictionary with initial key-value pairs. */
function dictionaryAction(
  items: Array<{
    key: string;
    value: string | { uuid: string; name: string };
    type?: number; // 0=text, 1=number
  }>,
  outputUuid: string
) {
  return {
    WFWorkflowActionIdentifier: 'is.workflow.actions.dictionary',
    WFWorkflowActionParameters: {
      UUID: outputUuid,
      WFItems: {
        Value: {
          WFDictionaryFieldValueItems: items.map((item) => {
            const isRef = typeof item.value === 'object';
            return {
              WFItemType: item.type ?? 0,
              WFKey: {
                Value: { string: item.key },
                WFSerializationType: 'WFTextTokenString',
              },
              WFValue: isRef
                ? {
                    Value: {
                      attachmentsByRange: {
                        '{0, 1}': {
                          OutputName: (item.value as { name: string }).name,
                          OutputUUID: (item.value as { uuid: string }).uuid,
                          Type: 'ActionOutput',
                        },
                      },
                      string: PH,
                    },
                    WFSerializationType: 'WFTextTokenString',
                  }
                : {
                    Value: { string: item.value as string },
                    WFSerializationType: 'WFTextTokenString',
                  },
            };
          }),
        },
        WFSerializationType: 'WFDictionaryFieldValue',
      },
    },
  };
}

/** Set a key on an existing dictionary. */
function setValueForKeyAction(
  dictUuid: string,
  dictName: string,
  key: string,
  valueRef: { uuid: string; name: string },
  outputUuid: string
) {
  return {
    WFWorkflowActionIdentifier: 'is.workflow.actions.setvalueforkey',
    WFWorkflowActionParameters: {
      UUID: outputUuid,
      WFDictionary: {
        Value: {
          OutputName: dictName,
          OutputUUID: dictUuid,
          Type: 'ActionOutput',
        },
        WFSerializationType: 'WFTextTokenAttachment',
      },
      WFDictionaryKey: key,
      WFDictionaryValue: {
        Value: {
          attachmentsByRange: {
            '{0, 1}': {
              OutputName: valueRef.name,
              OutputUUID: valueRef.uuid,
              Type: 'ActionOutput',
            },
          },
          string: PH,
        },
        WFSerializationType: 'WFTextTokenString',
      },
    },
  };
}

/** POST a dictionary as JSON to a URL with custom headers. */
function postAction(
  url: string,
  authToken: string,
  bodyUuid: string,
  bodyName: string,
  outputUuid: string
) {
  return {
    WFWorkflowActionIdentifier: 'is.workflow.actions.downloadurl',
    WFWorkflowActionParameters: {
      UUID: outputUuid,
      WFURL: url,
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
                Value: { string: authToken },
                WFSerializationType: 'WFTextTokenString',
              },
            },
          ],
        },
        WFSerializationType: 'WFDictionaryFieldValue',
      },
      WFRequestVariable: {
        Value: {
          OutputName: bodyName,
          OutputUUID: bodyUuid,
          Type: 'ActionOutput',
        },
        WFSerializationType: 'WFTextTokenAttachment',
      },
    },
  };
}

function showResultAction(text: string) {
  return {
    WFWorkflowActionIdentifier: 'is.workflow.actions.showresult',
    WFWorkflowActionParameters: { Text: text },
  };
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

interface MetricDef {
  healthName: string; // Shortcuts "Type" dropdown value
  jsonKey: string; // key in our ingest JSON
  stat: string; // Sum, Average, Minimum, Maximum
  jsonField: string; // sum, avg, min, max, last
}

const METRICS: MetricDef[] = [
  { healthName: 'Steps', jsonKey: 'StepCount', stat: 'Sum', jsonField: 'sum' },
  { healthName: 'Active Energy', jsonKey: 'ActiveEnergyBurned', stat: 'Sum', jsonField: 'sum' },
  { healthName: 'Exercise Minutes', jsonKey: 'AppleExerciseTime', stat: 'Sum', jsonField: 'sum' },
  {
    healthName: 'Walking + Running Distance',
    jsonKey: 'DistanceWalkingRunning',
    stat: 'Sum',
    jsonField: 'sum',
  },
  { healthName: 'Flights Climbed', jsonKey: 'FlightsClimbed', stat: 'Sum', jsonField: 'sum' },
  { healthName: 'Heart Rate', jsonKey: 'HeartRate', stat: 'Average', jsonField: 'avg' },
  {
    healthName: 'Resting Heart Rate',
    jsonKey: 'RestingHeartRate',
    stat: 'Average',
    jsonField: 'last',
  },
  {
    healthName: 'Heart Rate Variability',
    jsonKey: 'HeartRateVariabilitySDNN',
    stat: 'Average',
    jsonField: 'avg',
  },
];

// ---------------------------------------------------------------------------
// Build the complete shortcut
// ---------------------------------------------------------------------------

export function buildHealthShortcut(opts: ShortcutOptions): Buffer {
  const actions: Record<string, unknown>[] = [];

  // Comment header
  actions.push(
    commentAction(
      'DocVault Health Sync — auto-generated shortcut.\n' +
        'Reads 8 health metrics from today, aggregates them, and POSTs to DocVault.\n' +
        `Target: ${opts.ingestUrl}`
    )
  );

  // Step 1: Current Date
  const dateUuid = uuid();
  actions.push(dateAction(dateUuid));

  // Step 2: Format as yyyy-MM-dd
  const dateStrUuid = uuid();
  actions.push(formatDateAction(dateUuid, 'Current Date', dateStrUuid));

  // Steps 3-N: For each metric → Find Health Samples → Calculate Statistics
  const statRefs: Array<{ jsonKey: string; jsonField: string; uuid: string }> = [];
  for (const metric of METRICS) {
    const samplesUuid = uuid();
    const statUuid = uuid();
    actions.push(findHealthSamplesAction(metric.healthName, samplesUuid));
    actions.push(calculateStatisticsAction(samplesUuid, 'Health Samples', metric.stat, statUuid));
    statRefs.push({ jsonKey: metric.jsonKey, jsonField: metric.jsonField, uuid: statUuid });
  }

  // Build the payload dictionary: {date, source, metrics: {<key>: {<field>: <value>}}}
  // Start with the outer dict: date + source
  const outerDictUuid = uuid();
  actions.push(
    dictionaryAction(
      [
        { key: 'date', value: { uuid: dateStrUuid, name: 'Formatted Date' } },
        { key: 'source', value: 'shortcut-v1' },
      ],
      outerDictUuid
    )
  );

  // Build a metrics sub-dictionary with one key per metric
  const metricsDictUuid = uuid();
  actions.push(
    dictionaryAction(
      statRefs.map((r) => ({
        key: `${r.jsonKey}.${r.jsonField}`,
        value: { uuid: r.uuid, name: 'Statistics' },
        type: 1, // number
      })),
      metricsDictUuid
    )
  );

  // Set "metrics" key on the outer dict
  const finalDictUuid = uuid();
  actions.push(
    setValueForKeyAction(
      outerDictUuid,
      'Dictionary',
      'metrics',
      { uuid: metricsDictUuid, name: 'Dictionary' },
      finalDictUuid
    )
  );

  // POST to DocVault
  const responseUuid = uuid();
  actions.push(
    postAction(opts.ingestUrl, opts.authToken, finalDictUuid, 'Dictionary', responseUuid)
  );

  // Show result
  actions.push(showResultAction('DocVault sync complete'));

  // Assemble workflow
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
    WFWorkflowInputContentItemClasses: ['WFStringContentItem', 'WFGenericFileContentItem'],
    WFWorkflowHasOutputFallback: false,
    WFWorkflowHasShortcutInputVariables: false,
    WFWorkflowActions: actions,
  };

  return bplistCreator(workflow);
}
