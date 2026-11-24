// Generated from schemas/*.schema.json by scripts/generate.mjs. Do not edit: change the schema files and run it again.
export const SCHEMAS = {
  "activity": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "activity.schema.json",
    "title": "Activity",
    "description": "The one closed list of activities. `other` is anything not named. Display names are the app's job.",
    "type": "string",
    "enum": [
      "run",
      "long_run",
      "walk",
      "strength",
      "yoga",
      "ride",
      "swim",
      "elliptical",
      "stretch",
      "rest",
      "other"
    ]
  },
  "calendar-intent": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "calendar-intent.schema.json",
    "title": "Calendar intent",
    "description": "One change to the workout plan, sent to calendarPlan instead of a sentence. `add` needs `activity`. `exact` means start exactly at `after`, and needs `after`.",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "kind"
    ],
    "properties": {
      "kind": {
        "type": "string",
        "enum": [
          "add",
          "move",
          "resize",
          "cancel",
          "race"
        ]
      },
      "activity": {
        "$ref": "activity.schema.json"
      },
      "title": {
        "type": "string",
        "minLength": 1,
        "maxLength": 60
      },
      "minutes": {
        "type": "integer",
        "minimum": 5,
        "maximum": 240
      },
      "sessionId": {
        "type": "string",
        "minLength": 1
      },
      "targetWorkoutId": {
        "type": "string",
        "minLength": 1
      },
      "day": {
        "type": "string",
        "pattern": "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$"
      },
      "after": {
        "type": "string",
        "pattern": "^([01]\\d|2[0-3]):[0-5]\\d$"
      },
      "exact": {
        "type": "boolean"
      },
      "before": {
        "type": "string",
        "pattern": "^([01]\\d|2[0-3]):[0-5]\\d$"
      },
      "partOfDay": {
        "type": "string",
        "enum": [
          "morning",
          "afternoon",
          "evening"
        ]
      },
      "raceDate": {
        "type": "string",
        "pattern": "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$"
      },
      "distanceKm": {
        "type": "number",
        "exclusiveMinimum": 0,
        "maximum": 100
      }
    },
    "oneOf": [
      {
        "properties": {
          "kind": {
            "const": "add"
          }
        },
        "required": [
          "activity"
        ]
      },
      {
        "properties": {
          "kind": {
            "const": "move"
          }
        },
        "required": [
          "targetWorkoutId"
        ]
      },
      {
        "properties": {
          "kind": {
            "const": "resize"
          }
        },
        "required": [
          "targetWorkoutId"
        ]
      },
      {
        "properties": {
          "kind": {
            "const": "cancel"
          }
        },
        "required": [
          "targetWorkoutId"
        ]
      },
      {
        "properties": {
          "kind": {
            "const": "race"
          }
        },
        "required": [
          "raceDate"
        ]
      }
    ],
    "dependentRequired": {
      "exact": [
        "after"
      ]
    }
  },
  "calendar-result": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "calendar-result.schema.json",
    "title": "Calendar result",
    "description": "What calendarPlan and calendarReplan return. `state` is opaque. May carry more fields.",
    "type": "object",
    "required": [
      "ok",
      "kind",
      "message",
      "proposed",
      "undoToken",
      "state"
    ],
    "properties": {
      "ok": {
        "const": true
      },
      "kind": {
        "type": "string",
        "enum": [
          "add",
          "move",
          "resize",
          "cancel",
          "race",
          "question",
          "none"
        ]
      },
      "message": {
        "type": "string"
      },
      "proposed": {
        "type": "array",
        "items": {
          "$ref": "preview-block.schema.json"
        }
      },
      "question": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "text",
          "answers"
        ],
        "properties": {
          "text": {
            "type": "string",
            "minLength": 1
          },
          "answers": {
            "type": "array",
            "maxItems": 3,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "id",
                "label"
              ],
              "properties": {
                "id": {
                  "type": "string",
                  "minLength": 1
                },
                "label": {
                  "type": "string",
                  "minLength": 1
                }
              }
            }
          }
        }
      },
      "undoToken": {
        "type": "string",
        "minLength": 1
      },
      "replaces": {
        "type": "string",
        "minLength": 1
      },
      "state": {
        "type": "object"
      }
    }
  },
  "error": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "error.schema.json",
    "title": "Error",
    "description": "Every failure. `text` is one plain sentence the app can show.",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "ok",
      "error"
    ],
    "properties": {
      "ok": {
        "const": false
      },
      "error": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "code",
          "text"
        ],
        "properties": {
          "code": {
            "type": "string",
            "pattern": "^[A-Za-z][A-Za-z0-9_]*$"
          },
          "text": {
            "type": "string",
            "minLength": 1
          }
        }
      }
    }
  },
  "memory-row": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "memory-row.schema.json",
    "title": "Memory row",
    "description": "One memory in the daily table. `key` is opaque; what a consumer needs is in `data`, by `kind`.",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "memoryId",
      "key",
      "slot",
      "group",
      "kind",
      "statement",
      "data",
      "state",
      "confidence",
      "since",
      "updated"
    ],
    "properties": {
      "memoryId": {
        "type": "string",
        "minLength": 1
      },
      "key": {
        "type": "string",
        "minLength": 1
      },
      "slot": {
        "type": "string",
        "minLength": 1
      },
      "group": {
        "type": "string",
        "enum": [
          "routine",
          "body",
          "load",
          "response",
          "gear",
          "goal"
        ]
      },
      "kind": {
        "type": "string",
        "enum": [
          "usual_slot",
          "weekly_volume",
          "load",
          "sleep",
          "resting_hr",
          "mix",
          "response",
          "gear",
          "goal"
        ]
      },
      "statement": {
        "type": "string",
        "minLength": 1
      },
      "data": {
        "type": "object"
      },
      "state": {
        "type": "string",
        "enum": [
          "candidate",
          "saved",
          "confirmed",
          "rejected",
          "superseded",
          "inactive"
        ]
      },
      "confidence": {
        "type": "number",
        "minimum": 0,
        "maximum": 1
      },
      "since": {
        "type": "string",
        "pattern": "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$"
      },
      "updated": {
        "type": "string",
        "pattern": "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$"
      }
    },
    "oneOf": [
      {
        "properties": {
          "kind": {
            "const": "usual_slot"
          },
          "data": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "activity",
              "weekday",
              "hour",
              "minutes",
              "weeksSeen",
              "weeksTotal"
            ],
            "properties": {
              "activity": {
                "$ref": "activity.schema.json"
              },
              "weekday": {
                "type": "integer",
                "minimum": 0,
                "maximum": 6
              },
              "hour": {
                "type": "integer",
                "minimum": 0,
                "maximum": 23
              },
              "minutes": {
                "type": "integer",
                "minimum": 5,
                "maximum": 240
              },
              "weeksSeen": {
                "type": "integer",
                "minimum": 0
              },
              "weeksTotal": {
                "type": "integer",
                "minimum": 1
              },
              "label": {
                "type": "string",
                "minLength": 1
              }
            }
          }
        }
      },
      {
        "properties": {
          "kind": {
            "const": "weekly_volume"
          },
          "data": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "workoutsPerWeek",
              "minutesPerWeek"
            ],
            "properties": {
              "workoutsPerWeek": {
                "type": "number",
                "minimum": 0
              },
              "minutesPerWeek": {
                "type": "number",
                "minimum": 0
              }
            }
          }
        }
      },
      {
        "properties": {
          "kind": {
            "const": "load"
          },
          "data": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "minutes7d",
              "ratioToUsual"
            ],
            "properties": {
              "minutes7d": {
                "type": "number",
                "minimum": 0
              },
              "ratioToUsual": {
                "type": [
                  "number",
                  "null"
                ],
                "minimum": 0
              }
            }
          }
        }
      },
      {
        "properties": {
          "kind": {
            "const": "sleep"
          },
          "data": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "hours7d",
              "hours28d"
            ],
            "properties": {
              "hours7d": {
                "type": "number",
                "minimum": 0,
                "maximum": 24
              },
              "hours28d": {
                "type": "number",
                "minimum": 0,
                "maximum": 24
              }
            }
          }
        }
      },
      {
        "properties": {
          "kind": {
            "const": "resting_hr"
          },
          "data": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "bpm7d",
              "bpm28d"
            ],
            "properties": {
              "bpm7d": {
                "type": "number",
                "minimum": 20,
                "maximum": 250
              },
              "bpm28d": {
                "type": "number",
                "minimum": 20,
                "maximum": 250
              }
            }
          }
        }
      },
      {
        "properties": {
          "kind": {
            "const": "mix"
          },
          "data": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "byActivity"
            ],
            "properties": {
              "byActivity": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "run": {
                    "type": "integer",
                    "minimum": 0
                  },
                  "long_run": {
                    "type": "integer",
                    "minimum": 0
                  },
                  "walk": {
                    "type": "integer",
                    "minimum": 0
                  },
                  "strength": {
                    "type": "integer",
                    "minimum": 0
                  },
                  "yoga": {
                    "type": "integer",
                    "minimum": 0
                  },
                  "ride": {
                    "type": "integer",
                    "minimum": 0
                  },
                  "swim": {
                    "type": "integer",
                    "minimum": 0
                  },
                  "elliptical": {
                    "type": "integer",
                    "minimum": 0
                  },
                  "stretch": {
                    "type": "integer",
                    "minimum": 0
                  },
                  "rest": {
                    "type": "integer",
                    "minimum": 0
                  },
                  "other": {
                    "type": "integer",
                    "minimum": 0
                  }
                }
              }
            }
          }
        }
      },
      {
        "properties": {
          "kind": {
            "const": "response"
          },
          "data": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "about",
              "pattern"
            ],
            "properties": {
              "about": {
                "type": "string",
                "minLength": 1
              },
              "pattern": {
                "type": "string",
                "minLength": 1
              }
            }
          }
        }
      },
      {
        "properties": {
          "kind": {
            "const": "gear"
          },
          "data": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "item",
              "km",
              "boughtOn"
            ],
            "properties": {
              "item": {
                "type": "string",
                "minLength": 1
              },
              "km": {
                "type": "number",
                "minimum": 0
              },
              "boughtOn": {
                "type": [
                  "string",
                  "null"
                ],
                "pattern": "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$"
              }
            }
          }
        }
      },
      {
        "properties": {
          "kind": {
            "const": "goal"
          },
          "data": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "what",
              "date"
            ],
            "properties": {
              "what": {
                "type": "string",
                "minLength": 1
              },
              "date": {
                "type": [
                  "string",
                  "null"
                ],
                "pattern": "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$"
              }
            }
          }
        }
      }
    ]
  },
  "memory-table": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "memory-table.schema.json",
    "title": "Memory table",
    "description": "What memoryTable returns. May carry more fields.",
    "type": "object",
    "required": [
      "ok",
      "rows"
    ],
    "properties": {
      "ok": {
        "const": true
      },
      "rows": {
        "type": "array",
        "items": {
          "$ref": "memory-row.schema.json"
        }
      }
    }
  },
  "outcome": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "outcome.schema.json",
    "title": "Outcome",
    "description": "What happened to one planned session: done or missed.",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "sessionId",
      "day",
      "activity",
      "plannedStart",
      "done"
    ],
    "properties": {
      "sessionId": {
        "type": "string",
        "minLength": 1
      },
      "day": {
        "type": "string",
        "pattern": "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$"
      },
      "activity": {
        "$ref": "activity.schema.json"
      },
      "plannedStart": {
        "type": "string",
        "pattern": "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])T([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(\\.\\d{1,3})?[+-]([01]\\d|2[0-3]):[0-5]\\d$"
      },
      "done": {
        "type": "boolean"
      },
      "actualStart": {
        "type": "string",
        "pattern": "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])T([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(\\.\\d{1,3})?[+-]([01]\\d|2[0-3]):[0-5]\\d$"
      },
      "actualMinutes": {
        "type": "number",
        "minimum": 0,
        "maximum": 1440
      }
    }
  },
  "plan-check": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "plan-check.schema.json",
    "title": "Plan check",
    "description": "What checkPlan returns. `pass` is true only with no violations. May carry more fields.",
    "type": "object",
    "required": [
      "ok",
      "pass",
      "violations"
    ],
    "properties": {
      "ok": {
        "const": true
      },
      "pass": {
        "type": "boolean"
      },
      "violations": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "code",
            "text"
          ],
          "properties": {
            "code": {
              "type": "string",
              "minLength": 1
            },
            "text": {
              "type": "string",
              "minLength": 1
            },
            "sessionId": {
              "type": "string",
              "minLength": 1
            }
          }
        }
      }
    },
    "oneOf": [
      {
        "properties": {
          "pass": {
            "const": true
          },
          "violations": {
            "maxItems": 0
          }
        },
        "required": [
          "pass"
        ]
      },
      {
        "properties": {
          "pass": {
            "const": false
          },
          "violations": {
            "minItems": 1
          }
        },
        "required": [
          "pass"
        ]
      }
    ]
  },
  "plan": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "plan.schema.json",
    "title": "Plan",
    "description": "A proposed week. May carry more fields.",
    "type": "object",
    "required": [
      "ok",
      "sessions",
      "summary"
    ],
    "properties": {
      "ok": {
        "const": true
      },
      "sessions": {
        "type": "array",
        "items": {
          "$ref": "session.schema.json"
        }
      },
      "summary": {
        "type": "string",
        "minLength": 1
      }
    }
  },
  "preview-block": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "preview-block.schema.json",
    "title": "Preview block",
    "description": "One proposed change on the calendar. Nothing is written until the person confirms. A rest day spans its day and has minutes 0.",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "id",
      "activity",
      "title",
      "start",
      "end",
      "minutes",
      "status",
      "reason"
    ],
    "properties": {
      "id": {
        "type": "string",
        "minLength": 1
      },
      "sessionId": {
        "type": "string",
        "minLength": 1
      },
      "activity": {
        "$ref": "activity.schema.json"
      },
      "title": {
        "type": "string",
        "minLength": 1
      },
      "start": {
        "type": "string",
        "pattern": "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])T([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(\\.\\d{1,3})?[+-]([01]\\d|2[0-3]):[0-5]\\d$"
      },
      "end": {
        "type": "string",
        "pattern": "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])T([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(\\.\\d{1,3})?[+-]([01]\\d|2[0-3]):[0-5]\\d$"
      },
      "minutes": {
        "type": "integer",
        "minimum": 0,
        "maximum": 1440
      },
      "status": {
        "type": "string",
        "enum": [
          "new",
          "moved",
          "resized",
          "cancelled"
        ]
      },
      "reason": {
        "type": "string",
        "minLength": 1
      }
    }
  },
  "session": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "session.schema.json",
    "title": "Session",
    "description": "One proposed workout. `id` is stable for the same day, activity and start. `minutes` is 0 for rest.",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "id",
      "day",
      "start",
      "minutes",
      "activity",
      "intensity",
      "reason",
      "basedOn"
    ],
    "properties": {
      "id": {
        "type": "string",
        "minLength": 1
      },
      "day": {
        "type": "string",
        "pattern": "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$"
      },
      "start": {
        "type": "string",
        "pattern": "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])T([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(\\.\\d{1,3})?[+-]([01]\\d|2[0-3]):[0-5]\\d$"
      },
      "minutes": {
        "type": "integer",
        "minimum": 0,
        "maximum": 240
      },
      "activity": {
        "$ref": "activity.schema.json"
      },
      "intensity": {
        "type": "string",
        "enum": [
          "easy",
          "steady",
          "hard"
        ]
      },
      "reason": {
        "type": "string",
        "minLength": 1
      },
      "basedOn": {
        "type": "array",
        "items": {
          "type": "string",
          "minLength": 1
        }
      }
    }
  },
  "stopped-slot": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "stopped-slot.schema.json",
    "title": "Stopped slot",
    "description": "A usual time the person rejected: the data of a rejected usual_slot row. The app passes these to the recommendation agent, because rejected rows are not in the table.",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "activity",
      "weekday",
      "hour"
    ],
    "properties": {
      "key": {
        "type": "string",
        "minLength": 1
      },
      "activity": {
        "$ref": "activity.schema.json"
      },
      "weekday": {
        "type": "integer",
        "minimum": 0,
        "maximum": 6
      },
      "hour": {
        "type": "integer",
        "minimum": 0,
        "maximum": 23
      }
    }
  },
  "user-rules": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "user-rules.schema.json",
    "title": "User rules",
    "description": "The rules the person set, as the app hands them to the plan engine (planContext, recommendWeek and checkPlan take them as `rules`). Never worked out from data. Where home is stays on the phone and is not part of this value. Every field is optional; a missing one takes its default in recommend-agent/src/rules.mjs.",
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "restWeekdays": {
        "description": "Weekdays never planned, Monday 0 to Sunday 6.",
        "type": "array",
        "maxItems": 7,
        "items": {
          "type": "integer",
          "minimum": 0,
          "maximum": 6
        }
      },
      "sessionMinutes": {
        "description": "How long one home session lasts.",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "min",
          "max"
        ],
        "properties": {
          "min": {
            "type": "integer",
            "minimum": 10,
            "maximum": 90
          },
          "max": {
            "type": "integer",
            "minimum": 10,
            "maximum": 90
          }
        }
      },
      "window": {
        "description": "The earliest and the latest start, as HH:MM on the phone's clock.",
        "type": "object",
        "additionalProperties": false,
        "required": [
          "from",
          "to"
        ],
        "properties": {
          "from": {
            "type": "string",
            "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
          },
          "to": {
            "type": "string",
            "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
          }
        }
      },
      "mornings": {
        "description": "True lets a session start from 06:00. Off unless the person turns it on.",
        "type": "boolean"
      },
      "equipment": {
        "description": "What the person has to train with at home. Floor and wall are always there.",
        "type": "array",
        "items": {
          "enum": [
            "backpack",
            "chair",
            "table",
            "sofa",
            "book",
            "step",
            "floor",
            "wall"
          ]
        }
      },
      "avoid": {
        "description": "Movement ids never planned.",
        "type": "array",
        "items": {
          "type": "string",
          "pattern": "^[a-z0-9_]{1,48}$"
        }
      },
      "movements": {
        "description": "Movement id to what it is to the person.",
        "type": "object",
        "additionalProperties": {
          "enum": [
            "untried",
            "can",
            "cannot"
          ]
        }
      }
    }
  },
  "workout-content": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "workout-content.schema.json",
    "title": "Workout content",
    "description": "What one home session holds, as workoutContent and weekContent in recommend-agent/src/content.mjs return it and the workout page shows it: movements from the movement library (recommend-agent/data/movements.json), each with its sets, its range of reps or seconds, its rest and, for a backpack movement, the kilograms in the backpack. Every word the page shows about a movement comes from the library, never from this value.",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "sessionId",
      "focus",
      "minutes",
      "items"
    ],
    "properties": {
      "sessionId": {
        "description": "The session this is for, or null when built on its own.",
        "type": [
          "string",
          "null"
        ],
        "minLength": 1,
        "maxLength": 64
      },
      "focus": {
        "description": "What the session works.",
        "enum": [
          "full",
          "lower",
          "upper",
          "full_lower",
          "full_upper"
        ]
      },
      "minutes": {
        "description": "About how long it takes, rests and getting set up included.",
        "type": "integer",
        "minimum": 1,
        "maximum": 120
      },
      "items": {
        "type": "array",
        "minItems": 1,
        "maxItems": 8,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "movementId",
            "sets",
            "rest",
            "isNew"
          ],
          "properties": {
            "movementId": {
              "description": "A movement's id in the library.",
              "type": "string",
              "pattern": "^[a-z0-9_]{1,48}$"
            },
            "sets": {
              "type": "integer",
              "minimum": 1,
              "maximum": 6
            },
            "reps": {
              "description": "The lowest and highest reps a set aims for.",
              "type": "array",
              "minItems": 2,
              "maxItems": 2,
              "items": {
                "type": "integer",
                "minimum": 1,
                "maximum": 50
              }
            },
            "seconds": {
              "description": "The shortest and longest hold a set aims for.",
              "type": "array",
              "minItems": 2,
              "maxItems": 2,
              "items": {
                "type": "integer",
                "minimum": 5,
                "maximum": 300
              }
            },
            "load": {
              "description": "Kilograms in the backpack.",
              "type": "number",
              "minimum": 1,
              "maximum": 12
            },
            "rest": {
              "description": "Seconds of rest between sets.",
              "type": "integer",
              "minimum": 0,
              "maximum": 300
            },
            "isNew": {
              "description": "The person hasn't done it yet: the page asks first whether they can do one.",
              "type": "boolean"
            }
          },
          "oneOf": [
            {
              "required": [
                "reps"
              ]
            },
            {
              "required": [
                "seconds"
              ]
            }
          ]
        }
      }
    }
  }
};
