# Graph Report - veil  (2026-09-28)

## Corpus Check
- Corpus is ~21,597 words - fits in a single context window. You may not need a graph.

## Summary
- 420 nodes · 779 edges · 22 communities (19 shown, 3 thin omitted)
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 62 edges (avg confidence: 0.86)
- Token cost: 97,688 input · 0 output

## Community Hubs (Navigation)
- Demo Sites & Side Panel UI
- FastAPI Server
- Extension Package Config
- Side Panel Logic
- Server Leak Guard
- VEIL-Bench Generator
- Content Script DOM
- Message Types
- Architecture & Phases
- Policy, Vault & VRS
- DOM Sanitizer
- Detector & Vault Core
- Background Orchestrator
- Extension Tests
- PII Detection Rules
- Egress Firewall
- Checksum Validators
- TypeScript Config
- Runtime Messaging
- Settings Store

## God Nodes (most connected - your core abstractions)
1. `Model` - 20 edges
2. `Vault` - 19 edges
3. `VEIL: PRD, TRD and System Architecture` - 15 edges
4. `TokenClass` - 14 edges
5. `Phase 1: Foundation and round trip` - 12 edges
6. `sanitize()` - 11 edges
7. `run()` - 10 edges
8. `scripts` - 10 edges
9. `RulePlanner` - 10 edges
10. `StepRequest` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Typed placeholders (e.g. AADHAAR_1)` --semantically_similar_to--> `VEIL Redaction Schema (VRS v1)`  [INFERRED] [semantically similar]
  README.md → VEIL_ PRD, TRD and System Architecture.html
- `VEIL build phases` --semantically_similar_to--> `Four-week build plan`  [INFERRED] [semantically similar]
  PHASES.md → VEIL_ PRD, TRD and System Architecture.html
- `Card holder photo (SVG)` --conceptually_related_to--> `YuNet face detector`  [INFERRED]
  demo-sites/id-card.html → VEIL_ PRD, TRD and System Architecture.html
- `Alt+Shift+. stop and vault wipe` --references--> `Token vault (chrome.storage.session)`  [INFERRED]
  README.md → VEIL_ PRD, TRD and System Architecture.html
- `Phase 4: Server intelligence` --references--> `Set-of-mark overlay`  [EXTRACTED]
  PHASES.md → VEIL_ PRD, TRD and System Architecture.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **One agent step: perceive, sanitize, firewall, plan, execute** — veil__prd__trd_and_system_architecture_perception_worker, veil__prd__trd_and_system_architecture_redaction_engine, veil__prd__trd_and_system_architecture_token_vault, veil__prd__trd_and_system_architecture_egress_firewall, veil__prd__trd_and_system_architecture_router_planner_validator, veil__prd__trd_and_system_architecture_policy_engine, veil__prd__trd_and_system_architecture_action_executor [EXTRACTED 1.00]
- **Phase 1 demo: ID card to bank form round trip** — demo_sites_id_card_identity_card, demo_sites_bank_form_savings_account_form, extension_entrypoints_sidepanel_index_sidepanel_ui, phases_rule_planner, veil__prd__trd_and_system_architecture_token_vault [INFERRED 0.85]
- **Local vision model set on ONNX Runtime Web** — veil__prd__trd_and_system_architecture_deit_tiny_screen_classifier, veil__prd__trd_and_system_architecture_yolo11n_ui_detector, veil__prd__trd_and_system_architecture_yunet_face_detector, veil__prd__trd_and_system_architecture_pp_ocrv4, veil__prd__trd_and_system_architecture_onnx_runtime_web [EXTRACTED 1.00]

## Communities (22 total, 3 thin omitted)

### Community 0 - "Demo Sites & Side Panel UI"
Cohesion: 0.05
Nodes (65): faker (synthetic data), Password creation step, Demo Bank savings account form (3 steps), Thank-you message echoing name and mobile, Card holder photo (SVG), DigiLocker Demo identity card (synthetic Ananya Rao), Secure QR code (SVG), Demo Telecom choose-a-plan page (+57 more)

### Community 1 - "FastAPI Server"
Cohesion: 0.09
Nodes (44): BaseModel, delete, fastapi, fastapi_middleware_cors, get, middleware, os, post (+36 more)

### Community 2 - "Extension Package Config"
Cohesion: 0.07
Nodes (25): description, devDependencies, @types/chrome, @types/node, typescript, vitest, wxt, name (+17 more)

### Community 3 - "Side Panel Logic"
Cohesion: 0.09
Nodes (23): addLog(), approval, el(), frame, frameEmpty, fwList, goal, images (+15 more)

### Community 4 - "Server Leak Guard"
Cohesion: 0.17
Nodes (23): Any, dataclasses, re, digits(), Leak, luhn(), Server-side leak guard. Defence in depth: the client should never send raw…, scan() (+15 more)

### Community 5 - "VEIL-Bench Generator"
Cohesion: 0.14
Nodes (21): argparse, field(), gt(), kyc_form(), luhn_digit(), main(), Person, profile() (+13 more)

### Community 6 - "Content Script DOM"
Cohesion: 0.18
Nodes (21): collectTexts(), contentBox(), contextClassFor(), execute(), highlight(), inViewport(), isVisible(), labelOf() (+13 more)

### Community 7 - "Message Types"
Cohesion: 0.15
Nodes (18): CompositeRequest, CompositeResult, ExecAction, ExecResult, Mark, PanelEvent, PanelRequest, RawElement (+10 more)

### Community 8 - "Architecture & Phases"
Cohesion: 0.17
Nodes (19): VEIL perception host (offscreen page), Phase 2: Local vision, Phase 3: Privacy engine hardening, Phase 6: Benchmark, performance, demo, Change gate (dHash + DOM mutation counter), DeiT-Tiny screen-state ViT, DistilBERT NER via Transformers.js, DOM first, vision second (+11 more)

### Community 9 - "Policy, Vault & VRS"
Cohesion: 0.15
Nodes (15): formatHint(), COMPAT, decide(), Verdict, DICT_CLASSES, VAULT_TTL_MS, Action, ClassGroup (+7 more)

### Community 10 - "DOM Sanitizer"
Cohesion: 0.16
Nodes (15): Mask, RawSnapshot, classFromAutocomplete(), Term, collapse(), FIELD_ROLES, fieldClassOf(), guessState() (+7 more)

### Community 11 - "Detector & Vault Core"
Cohesion: 0.16
Nodes (8): Detector, Span, normalizeValue(), PolicyContext, Entry, Vault, makeToken(), TokenClass

### Community 12 - "Background Orchestrator"
Cohesion: 0.30
Nodes (14): act(), activeTab(), api(), ask(), buildRequest(), compositeAnywhere(), perceive(), Perception (+6 more)

### Community 13 - "Extension Tests"
Cohesion: 0.18
Nodes (8): raw, el(), request(), snap(), ref_lib, ref_node_fs, ref_node_url, vitest

### Community 14 - "PII Detection Rules"
Cohesion: 0.23
Nodes (13): AUTOCOMPLETE, classFromContext(), CONTEXT_RULES, detectAll(), detectLabelValue(), DETECTORS, detectPatterns(), dictSpans() (+5 more)

### Community 15 - "Egress Firewall"
Cohesion: 0.24
Nodes (10): destinationAllowed(), egressFetch(), escapeRe(), firewall(), LOCAL_HOSTS, strings(), valuePatterns(), FirewallCheck (+2 more)

### Community 16 - "Checksum Validators"
Cohesion: 0.21
Nodes (11): D, DIGIT_CLASSES, digitsOf(), INV, LOWER_CLASSES, luhn(), P, SHAPE_CLASSES (+3 more)

### Community 17 - "TypeScript Config"
Cohesion: 0.29
Nodes (6): compilerOptions, noEmit, noUncheckedIndexedAccess, strict, extends, ./.wxt/tsconfig.json

### Community 19 - "Settings Store"
Cohesion: 0.50
Nodes (4): DEFAULTS, getSettings(), setSettings(), Settings

## Knowledge Gaps
- **88 isolated node(s):** `Task`, `Perception`, `registry`, `goal`, `scanBtn` (+83 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 127 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Vault` connect `Detector & Vault Core` to `Policy, Vault & VRS`, `DOM Sanitizer`, `Extension Tests`, `Egress Firewall`?**
  _High betweenness centrality (0.146) - this node is a cross-community bridge._
- **Why does `vitest` connect `Extension Tests` to `Extension Package Config`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **What connects `Task`, `Perception`, `registry` to the rest of the system?**
  _88 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Demo Sites & Side Panel UI` be split into smaller, more focused modules?**
  _Cohesion score 0.05480769230769231 - nodes in this community are weakly interconnected._
- **Should `FastAPI Server` be split into smaller, more focused modules?**
  _Cohesion score 0.09224489795918367 - nodes in this community are weakly interconnected._
- **Should `Extension Package Config` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._
- **Should `Side Panel Logic` be split into smaller, more focused modules?**
  _Cohesion score 0.08615384615384615 - nodes in this community are weakly interconnected._