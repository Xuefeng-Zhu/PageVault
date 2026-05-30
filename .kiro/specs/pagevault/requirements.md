# Requirements Document

## Introduction

PageVault is an AI memory layer for the public web. It captures public web page snapshots using Apify, stores every snapshot and generated report as evidence in Box, persists snapshot and analysis metadata in an Insforge Postgres backend, and uses an OpenAI-compatible Large Language Model to compare page versions and explain what changed and why it matters.

A user creates a Memory Room for a company or website, adds URLs to monitor, runs a scan, and reviews AI-generated change analysis on a dashboard. Each analysis classifies severity and change type, summarizes the change, supplies before/after evidence, interprets the business impact, and recommends actions. The product is delivered as a Next.js/TypeScript full-stack application and includes a Demo Mode with seeded before/after data so the application runs reliably during a hackathon demonstration even when third-party credentials are absent.

Core tagline: "Apify captures the web. Box stores the memory. AI explains the change."

## Glossary

- **PageVault**: The full-stack application comprising the frontend, the backend API, and the integration libraries.
- **Backend_API**: The Next.js server-side API route layer that handles requests for rooms, URLs, scans, changes, and demo seeding.
- **Frontend_UI**: The React/Next.js client interface, including the home page, rooms dashboard, room detail page, change timeline, and change detail page.
- **Memory_Room**: A user-owned monitoring workspace for one company or website, persisted in the `memory_rooms` table.
- **Watched_URL**: A single monitored web address belonging to a Memory_Room, persisted in the `watched_urls` table.
- **Scan_Run**: A single execution of a scan over a Memory_Room's Watched_URLs, persisted in the `scan_runs` table.
- **Page_Snapshot**: A captured version of a Watched_URL's content at a point in time, persisted in the `page_snapshots` table.
- **Change_Analysis**: An AI-generated comparison between a previous and current Page_Snapshot, persisted in the `change_analyses` table.
- **Apify_Client**: The integration library (`lib/apify.ts`) that crawls URLs via the Apify API or returns mock results.
- **Box_Client**: The integration library (`lib/box.ts`) that creates folders, uploads files, and produces Box URLs, or returns mock identifiers and URLs.
- **AI_Analyzer**: The integration library (`lib/ai.ts`) that requests change analysis from the LLM or returns deterministic mock analysis.
- **Diff_Engine**: The integration library (`lib/diff.ts`) that hashes content and determines whether a meaningful change occurred.
- **Insforge_Backend**: The Insforge service providing authentication, the Postgres database, and storage/functions.
- **Demo_Mode**: The operating mode in which PageVault uses mock data and seeded content instead of calling external services.
- **Severity**: A classification of change importance with the allowed values `low`, `medium`, and `high`.
- **Change_Type**: A classification of change category with the allowed values `pricing`, `positioning`, `feature`, `legal`, `security`, `hiring`, `docs`, `minor`, and `unknown`.
- **Page_Type**: A classification of a Watched_URL with the allowed values `homepage`, `pricing`, `docs`, `changelog`, `careers`, `terms`, `privacy`, `trust`, and `unknown`.
- **Content_Hash**: A deterministic hash of a Page_Snapshot's normalized text content used to detect change.
- **Evidence_Item**: A structured record containing a `before` value, an `after` value, and an `explanation` value.
- **Required_Credential**: An environment variable that an integration requires to call its external service.

## Requirements

### Requirement 1: Create Memory Room

**User Story:** As a user, I want to create a Memory Room for a company or website, so that I can organize the pages I monitor.

#### Acceptance Criteria

1. WHEN the Backend_API receives a create-room request containing a name of 1 to 200 characters, a target name of 1 to 200 characters, and a category, THE Backend_API SHALL insert a row into the `memory_rooms` table with the provided name, target name, and category.
2. WHEN a create-room request omits the category or provides an empty category, THE Backend_API SHALL store the category value `competitor`.
3. IF a create-room request omits the name or the target name, provides a name or target name that is empty or contains only whitespace, or provides a name or target name longer than 200 characters, THEN THE Backend_API SHALL return a validation error identifying the invalid field and SHALL NOT insert a row.
4. WHEN the Backend_API creates a Memory_Room, THE Backend_API SHALL request a Box folder named `/PageVault/{name}` from the Box_Client and store the returned folder identifier in the `box_folder_id` column.
5. WHEN the Backend_API successfully creates a Memory_Room, THE Backend_API SHALL return the created Memory_Room including its identifier and Box folder identifier.
6. IF the Box_Client returns a system error while creating the Memory_Room's Box folder, THEN THE Backend_API SHALL return a system error indicating the Box folder could not be created and SHALL NOT return a created Memory_Room.

### Requirement 2: List Memory Rooms

**User Story:** As a user, I want to see all of my Memory Rooms, so that I can navigate to the one I want to review.

#### Acceptance Criteria

1. WHEN the Backend_API receives a list-rooms request, THE Backend_API SHALL return all Memory_Room records, and SHALL return an empty collection when no Memory_Room records exist.
2. WHEN the Backend_API returns a Memory_Room, THE Backend_API SHALL include the count of `high` severity Change_Analysis records and the count of `medium` severity Change_Analysis records for that Memory_Room, defaulting each count to zero when the Memory_Room has no Change_Analysis records of that severity.
3. WHEN the Backend_API returns a Memory_Room that has at least one completed Scan_Run, THE Backend_API SHALL include the completion time of the most recently completed Scan_Run for that Memory_Room.
4. WHEN the Backend_API returns a Memory_Room that has no completed Scan_Run, THE Backend_API SHALL return an absent last-scan time for that Memory_Room.
5. IF the Backend_API fails to retrieve the Memory_Room records, THEN THE Backend_API SHALL return an error and SHALL NOT return partial Memory_Room data.

### Requirement 3: Add Watched URLs

**User Story:** As a user, I want to add the URLs I want to monitor to a Memory Room, so that scans capture the pages I care about.

#### Acceptance Criteria

1. WHEN the Backend_API receives an add-URLs request containing a room identifier and a non-empty array of 1 to 100 URL entries, THE Backend_API SHALL insert one row into the `watched_urls` table for each URL entry, associated with the identified Memory_Room.
2. WHEN a URL entry includes a label of 1 to 200 characters and a page type that is one of the values `homepage`, `pricing`, `docs`, `changelog`, `careers`, `terms`, `privacy`, `trust`, or `unknown`, THE Backend_API SHALL store the provided label and page type.
3. WHEN a URL entry omits the page type or provides a page type outside the values `homepage`, `pricing`, `docs`, `changelog`, `careers`, `terms`, `privacy`, `trust`, and `unknown`, THE Backend_API SHALL store the page type `unknown`.
4. IF an add-URLs request references a room identifier that has no matching Memory_Room, THEN THE Backend_API SHALL return a not-found error and SHALL NOT insert any row.
5. IF a URL entry omits the url value, provides a url value that is not a valid absolute HTTP or HTTPS URL, or provides a label longer than 200 characters, THEN THE Backend_API SHALL return a validation error identifying the invalid entry and SHALL NOT insert any row for the request.
6. IF an add-URLs request contains an empty array of URL entries or more than 100 URL entries, THEN THE Backend_API SHALL return a validation error and SHALL NOT insert any row.

### Requirement 4: Run a Scan

**User Story:** As a user, I want to run a scan over a Memory Room's URLs, so that PageVault captures the current state of each monitored page.

#### Acceptance Criteria

1. WHEN the Backend_API receives a run-scan request for an existing Memory_Room, THE Backend_API SHALL insert a Scan_Run row with status `running` before requesting any crawl.
2. WHEN a scan begins, THE Backend_API SHALL load all Watched_URLs belonging to the identified Memory_Room.
3. WHEN one or more Watched_URLs are loaded, THE Backend_API SHALL request a crawl of those URLs from the Apify_Client and retrieve the resulting page results.
4. WHEN the crawl results are retrieved, THE Backend_API SHALL normalize each result into content using the result's markdown when present and otherwise the result's plain text.
5. WHEN the Backend_API completes processing all crawl results, THE Backend_API SHALL set the Scan_Run status to `completed` and set the `completed_at` time to the time processing finished.
6. WHEN a Scan_Run reaches status `completed`, THE Backend_API SHALL return a scan summary that includes the Scan_Run status, the count of captured Page_Snapshots, and the count of created Change_Analyses.
7. IF the crawl or any processing step fails after the Scan_Run is created, THEN THE Backend_API SHALL set the Scan_Run status to `failed`, SHALL NOT set the status to `completed`, and SHALL store a message indicating the cause of the failure in the `error_message` column.
8. IF a run-scan request references a room identifier that has no matching Memory_Room, THEN THE Backend_API SHALL return a not-found error and SHALL NOT insert a Scan_Run row.
9. WHEN a scan begins for a Memory_Room that has no Watched_URLs, THE Backend_API SHALL set the Scan_Run status to `completed` without requesting a crawl and return a scan summary with a captured Page_Snapshot count of zero and a created Change_Analysis count of zero.

### Requirement 5: Capture and Store Page Snapshots

**User Story:** As a user, I want each scanned page captured and stored as evidence, so that I have a durable record of every page version.

#### Acceptance Criteria

1. WHEN the Backend_API processes a normalized crawl result for a Watched_URL, THE Diff_Engine SHALL compute a Content_Hash from the normalized text content.
2. WHEN a Page_Snapshot is captured, THE Backend_API SHALL insert a `page_snapshots` row containing the room identifier, the watched URL identifier, the scan run identifier, the url, the title, the text content, and the Content_Hash, storing an empty title when the crawl result provides no title.
3. WHEN a Page_Snapshot is captured, THE Backend_API SHALL upload the snapshot content as a markdown file to the Box_Client under the path `/PageVault/{room}/snapshots/{timestamp}/`, where `{timestamp}` is the start time of the current Scan_Run, and SHALL store the file identifier returned by the Box_Client in the `box_file_id` column of the corresponding `page_snapshots` row.
4. WHEN a scan runs, THE Backend_API SHALL upload the raw Apify crawl results as a file named `raw-apify-results.json` to the Box_Client under the path `/PageVault/{room}/snapshots/{timestamp}/`, using the same `{timestamp}` value derived from the current Scan_Run's start time so that the raw results and the scan's Page_Snapshots reside in the same folder.
5. WHEN the Backend_API searches for the previous Page_Snapshot of a Watched_URL, THE Backend_API SHALL select the Page_Snapshot for that Watched_URL whose capture time is the latest among those strictly earlier than the current Page_Snapshot's capture time.
6. WHEN the previous-snapshot search returns no Page_Snapshot for a Watched_URL, THE Backend_API SHALL retain the current Page_Snapshot and proceed to process the remaining Watched_URLs without creating a Change_Analysis for that Watched_URL.

### Requirement 6: Detect Meaningful Change

**User Story:** As a user, I want PageVault to detect when a page has actually changed, so that analysis runs only when content differs.

#### Acceptance Criteria

1. WHEN a current Page_Snapshot and a previous Page_Snapshot exist for the same Watched_URL, THE Diff_Engine SHALL compare their Content_Hash values and report a meaningful change when the values are not equal and report no meaningful change when the values are equal.
2. IF no previous Page_Snapshot exists for a Watched_URL, THEN THE Backend_API SHALL store the current Page_Snapshot and SHALL NOT create a Change_Analysis for that Watched_URL.
3. IF the current and previous Content_Hash values are equal, THEN THE Backend_API SHALL NOT create a Change_Analysis for that Watched_URL.
4. WHEN the current and previous Content_Hash values are not equal, THE Backend_API SHALL request exactly one Change_Analysis from the AI_Analyzer for that Watched_URL.

### Requirement 7: Generate AI Change Analysis

**User Story:** As a user, I want an AI explanation of each detected change, so that I understand what changed and why it matters.

#### Acceptance Criteria

1. WHEN the Backend_API requests analysis of a changed Watched_URL, THE AI_Analyzer SHALL receive the url, the page type, the previous snapshot text, and the current snapshot text.
2. WHEN the AI_Analyzer produces a result, THE AI_Analyzer SHALL return a Severity value, a Change_Type value, a non-empty summary, a non-empty business interpretation, an array of at least one Evidence_Item each containing a before value, an after value, and an explanation value, and an array of recommended actions.
3. IF a change alters only wording, formatting, or layout without changing pricing, availability, security, legal, or feature meaning, THEN THE AI_Analyzer SHALL classify the change as Severity `low`.
4. IF a change alters pricing, policy, security, legal, or product availability, THEN THE AI_Analyzer SHALL classify the change as Severity `medium` or `high` and SHALL NOT classify the change as Severity `low`.
5. WHEN the AI_Analyzer produces a result, THE AI_Analyzer SHALL derive the summary, the business interpretation, the recommended actions, and each Evidence_Item only from the provided previous and current snapshot text, with each Evidence_Item before value drawn from the previous snapshot text and each Evidence_Item after value drawn from the current snapshot text.
6. WHEN the AI_Analyzer returns a result, THE Backend_API SHALL insert a `change_analyses` row containing the room identifier, the watched URL identifier, the previous snapshot identifier, the current snapshot identifier, the Severity, the Change_Type, the summary, the business interpretation, the recommended actions, and the evidence.
7. WHEN a Change_Analysis is created, THE Backend_API SHALL upload the analysis as a markdown report to the Box_Client under the path `/PageVault/{room}/reports/` and store the returned file identifier in the `report_box_file_id` column.
8. IF the AI_Analyzer returns a Severity value outside the set {`low`, `medium`, `high`}, THEN THE Backend_API SHALL store the Severity `low` and store the remaining returned values unchanged.
9. IF the AI_Analyzer returns a Change_Type value outside the defined set, THEN THE Backend_API SHALL store the Change_Type `unknown` and store the remaining returned values unchanged.

### Requirement 8: View Room Detail

**User Story:** As a user, I want to open a Memory Room and see its pages, scan status, and recent changes, so that I can review one target in depth.

#### Acceptance Criteria

1. WHEN the Backend_API receives a room-detail request for an existing Memory_Room, THE Backend_API SHALL return the Memory_Room, its Watched_URLs, its most recent Scan_Run by start time, and its most recent Change_Analyses ordered most-recent-first by creation time up to a maximum of 20 records.
2. WHEN the Backend_API receives a room-detail request, THE Backend_API SHALL return exactly one of either the room detail data or an error response that identifies the failure reason.
3. IF a room-detail request references a room identifier that has no matching Memory_Room, THEN THE Backend_API SHALL return a not-found error and SHALL NOT return room detail data.
4. WHEN the Frontend_UI displays a room detail page, THE Frontend_UI SHALL display the room title, the target name, the Watched_URLs, a Run Scan control, an Open Box Folder control, the latest Scan_Run status, and a latest changes timeline containing the most recent Change_Analyses ordered most-recent-first up to a maximum of 20 entries.
5. IF the requested room is missing or fails to load, THEN THE Frontend_UI SHALL render the room detail page layout, display a placeholder indicator for each unavailable section, and SHALL NOT raise an unhandled error.
6. WHEN the Frontend_UI displays the Open Box Folder control, THE Frontend_UI SHALL link the control to the Box folder URL produced by the Box_Client for the room's Box folder identifier.

### Requirement 9: View Change Timeline

**User Story:** As a user, I want a timeline of changes for a Memory Room, so that I can track how a target evolves over time.

#### Acceptance Criteria

1. WHEN the Backend_API receives a changes-timeline request for an existing Memory_Room, THE Backend_API SHALL return the Change_Analysis records for that Memory_Room ordered from most recent to least recent by creation time, breaking ties by descending Change_Analysis identifier.
2. WHEN the Backend_API receives a changes-timeline request for a Memory_Room that has no Change_Analysis records, THE Backend_API SHALL return an empty collection.
3. IF a changes-timeline request references a room identifier that has no matching Memory_Room, THEN THE Backend_API SHALL return a not-found error and SHALL NOT return any Change_Analysis records.
4. WHEN the Frontend_UI displays the change timeline, THE Frontend_UI SHALL render one change card per returned Change_Analysis in the returned order, and each change card SHALL display the Severity badge reflecting the Change_Analysis Severity value, the Change_Type, the summary, the page url, the creation time, and the count of recommended actions.
5. WHEN the Frontend_UI displays the change timeline for a Memory_Room with no Change_Analysis records, THE Frontend_UI SHALL display empty or placeholder content and SHALL NOT render a change card.

### Requirement 10: View Change Detail

**User Story:** As a user, I want to open a single change and see its full analysis, so that I can act on the AI's findings.

#### Acceptance Criteria

1. WHEN the Backend_API receives a change-detail request for a change identifier that has a matching Change_Analysis, THE Backend_API SHALL return the Severity, the Change_Type, the summary, the business interpretation, the evidence as an array of Evidence_Items each containing a before value, an after value, and an explanation value, the recommended actions as an array, and the Box report file identifier for that Change_Analysis.
2. IF a change-detail request references a change identifier that has no matching Change_Analysis, THEN THE Backend_API SHALL return a not-found error indicating that the referenced change identifier was not found.
3. WHEN the Frontend_UI displays a change detail page for a found Change_Analysis, THE Frontend_UI SHALL display the Severity, the Change_Type, the summary, the business interpretation, a before/after evidence table containing the before value, the after value, and the explanation value of each Evidence_Item, the recommended actions, and a control linked to the Box report file URL produced by the Box_Client for that Change_Analysis's report file identifier.
4. IF a change-detail request returns a not-found error, THEN THE Frontend_UI SHALL display a not-found indication identifying that the change does not exist and SHALL NOT display the Severity, the Change_Type, the summary, the business interpretation, the evidence table, the recommended actions, or the Box report link.

### Requirement 11: Seed Demo Data

**User Story:** As a presenter, I want to seed a complete demo room with before/after data, so that the application demonstrates reliably during a hackathon.

#### Acceptance Criteria

1. WHEN the Backend_API receives a demo-seed request, THE Backend_API SHALL create a Memory_Room for the target named DemoCo with Watched_URLs for Homepage, Pricing, Security Docs, Changelog, and Careers.
2. WHEN the Backend_API seeds demo data, THE Backend_API SHALL create a previous Page_Snapshot and a current Page_Snapshot for each seeded Watched_URL that has a demo change.
3. WHEN the Backend_API seeds demo data, THE Backend_API SHALL create Change_Analysis records that include the pricing change from "Unlimited projects" to "10 projects", the SSO change from Starter to Enterprise, the API access change from Starter to Pro, the homepage positioning change from "for small teams" to "for modern enterprises", and the Careers addition of "Enterprise Account Executive".
4. WHEN the Backend_API seeds the demo Change_Analyses, THE Backend_API SHALL set a business interpretation describing DemoCo moving upmarket and SHALL include the recommended actions to update the competitive battlecard, review vendor renewal risk, ask whether existing customers are grandfathered, and monitor future pricing changes.
5. WHEN the demo seed completes, THE Backend_API SHALL return the identifier of the seeded Memory_Room.
6. IF the creation of an individual demo Change_Analysis or Page_Snapshot fails, THEN THE Backend_API SHALL create the records that can be created and continue the seeding operation.

### Requirement 12: Crawl Pages via Apify Integration

**User Story:** As a developer, I want a crawl integration that works with or without Apify credentials, so that scans run in production and in demo environments.

#### Acceptance Criteria

1. WHERE the Apify API token and actor identifier are configured, THE Apify_Client SHALL call the Apify API to crawl the provided URLs and return the dataset results.
2. WHERE the Apify API token or actor identifier is absent, THE Apify_Client SHALL return mock crawl results.
3. WHEN the Apify_Client returns a page result, THE Apify_Client SHALL include the url and the capture time, and SHALL always include the title, text, html, and markdown values whenever those values are available.
4. WHEN the Apify_Client returns mock results, THE Apify_Client SHALL include two versions of a pricing page where the before version contains "Unlimited projects included on Starter", "SSO included", and "API access included", and the after version contains "10 projects included on Starter", "SSO available on Enterprise", and "API access available on Pro".
5. IF the Apify API call fails, THEN THE Apify_Client SHALL return mock crawl results.

### Requirement 13: Store Evidence via Box Integration

**User Story:** As a developer, I want a Box integration that works with or without Box credentials, so that evidence storage never blocks a scan.

#### Acceptance Criteria

1. WHERE the Box credentials are configured, THE Box_Client SHALL create folders, upload text files, and produce folder and file URLs through the Box API.
2. WHERE the Box credentials are configured AND a Box API operation fails, THE Box_Client SHALL propagate the failure to the caller as a system error.
3. WHERE the Box credentials are absent, THE Box_Client SHALL return mock folder identifiers, mock file identifiers, and mock URLs.
4. WHEN the Box_Client uploads a snapshot, THE Box_Client SHALL place the file under the path `/PageVault/{room}/snapshots/{timestamp}/`.
5. WHEN the Box_Client uploads a report, THE Box_Client SHALL place the file under the path `/PageVault/{room}/reports/`.

### Requirement 14: Analyze Changes via AI Integration

**User Story:** As a developer, I want an AI integration that works with or without LLM credentials, so that analysis always produces a result.

#### Acceptance Criteria

1. WHERE the LLM credentials are configured, THE AI_Analyzer SHALL request analysis from the OpenAI-compatible API using a PageVault analyst prompt that instructs the model to return JSON only.
2. WHEN the AI_Analyzer receives the model response, THE AI_Analyzer SHALL parse a JSON object containing severity, change type, summary, business interpretation, an evidence array, and a recommended actions array.
3. WHERE the LLM credentials are absent, THE AI_Analyzer SHALL return a deterministic mock analysis.
4. IF the LLM call fails, THEN THE AI_Analyzer SHALL return a deterministic mock analysis regardless of whether the failure response contains parseable content.
5. IF the LLM call succeeds but returns content that cannot be parsed as the expected JSON object, THEN THE AI_Analyzer SHALL return a deterministic mock analysis.

### Requirement 15: Operate Without Credentials

**User Story:** As a presenter, I want the application to run without any third-party credentials, so that a missing key never crashes the demo.

#### Acceptance Criteria

1. IF a Required_Credential for an integration is completely absent, THEN THE corresponding integration library SHALL operate in Demo_Mode instead of raising an unhandled error.
2. IF the Insforge_Backend connection is unavailable, THEN THE Frontend_UI SHALL display setup instructions describing the required configuration.
3. WHILE any integration operates in Demo_Mode, THE Backend_API SHALL complete scan, analysis, and storage operations using mock results.

### Requirement 16: View Home and Rooms Dashboard

**User Story:** As a user, I want a home page and a rooms dashboard, so that I can understand PageVault and reach my Memory Rooms.

#### Acceptance Criteria

1. WHEN the Frontend_UI displays the home page, THE Frontend_UI SHALL display the product name PageVault, the tagline "AI memory for the changing web", a "Create Memory Room" control, and a "Load Demo" control.
2. WHEN a user activates the "Load Demo" control, THE Frontend_UI SHALL request the demo seed from the Backend_API and then display the seeded Memory_Room.
3. WHEN the Frontend_UI displays the rooms dashboard, THE Frontend_UI SHALL display one card per Memory_Room containing the name, the target name, the category, the last scan time, the count of high and medium changes, an Open Room control, and an Open Box Folder link.
