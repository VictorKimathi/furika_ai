# Furika Chatbot Guide for Underwriters

## 1. Purpose

Furika, shown in the workspace as **Ask Furi**, is an AI-assisted flood-risk and underwriting analysis tool. It helps an underwriter ask questions about:

- The current portfolio
- An individual property
- Flood susceptibility, damage, losses, annual average loss and scenarios
- Uploaded exposure files and placement documents
- A single placement offer or broker memorandum
- The model workflow and items requiring review

Furika is an analyst assistant, not an underwriting authority. It does not approve cover, bind a risk, confirm a property, or replace an underwriter's judgement.

The current implementation is a research prototype. Results are based on synthetic or redacted data and, where indicated, susceptibility proxies and modelling assumptions rather than measured flood depth or calibrated flood probability.

## 2. Opening the chatbot

1. Sign in and open the workspace.
2. Select **Furika Bot** in the left navigation if it is not already selected.
3. The chat panel opens with the title **Ask Furi** and the subtitle **Your flood-risk assistant**.
4. The first message explains that Furi can answer questions about a portfolio, property flood risk or losses, and files added as context.
5. The welcome screen offers suggested prompts. The suggestions depend on the current state:
   - No files and no approved results: `How do I assess a property?`, `What can I ask about flood risk?`, `What should I upload?`
   - Files available: `Summarise my uploaded data`, `Which properties need attention?`, `What should I review first?`
   - Approved portfolio results available: `Summarise my portfolio results`, `Where is loss concentrated?`, `What needs my review?`

Clicking a suggested prompt sends it in the same way as a typed question.

## 3. What the underwriter enters

### 3.1 Normal chat question

Type a question in the message box labelled **Ask Furi a question**. Examples:

- `Summarise my portfolio results.`
- `Which properties have the highest severe-tier hazard proxy?`
- `Explain the risk for NBO-0002.`
- `What is the AAL for the portfolio?`
- `Where is loss concentrated?`
- `What does the flood deductible say in the uploaded offer?`
- `Explain the limitations of the hazard scores.`
- `What should I review first?`

Press **Send** or press Enter. Use Shift+Enter to add a new line.

The question is trimmed before it is sent. An empty question cannot be submitted. A second request cannot be submitted while Furi is working.

### 3.2 Asking about a map item or property

The underwriter can select a property or reference hotspot elsewhere in the workspace and choose its ask/chat action. Furika then creates a question such as:

`Explain the risk for property NBO-0002.`

For a hotspot it uses:

`Explain the risk for reference hotspot <name or ID>.`

The selected property or hotspot ID is added to the request context so the backend prioritises that item.

### 3.3 Adding saved files as context

Select **Add file** beside the composer. The picker has two tabs:

- **Saved files**: choose files already stored for this portfolio.
- **Upload new**: upload a new file and use it for the next question.

In Saved files:

- Select or deselect a file by clicking it.
- Up to five distinct files can be selected for one question.
- The composer displays selected file names and lets the underwriter remove each one.
- Files still processing cannot be submitted as context.
- Click **Done** to close the picker.

When no files are explicitly selected, the backend automatically uses up to the three most recent completed, parsed uploads for normal portfolio questions. The response still identifies its sources.

### 3.4 Uploading a new file from the chatbot

In the **Upload new** tab, the underwriter must first declare that the file contains either:

- **Synthetic data**, or
- **Redacted data**

The file picker remains disabled until one option is selected. The UI specifically asks the user not to upload real client documents, named contacts or confidential terms.

The chatbot upload supports the same ingestion pipeline as Data store:

- CSV
- XLSX / Excel
- PDF
- DOCX / Word
- TXT
- MD / Markdown

Each file is limited to 20 MB. Files are checked by extension and file signature. Duplicate files are retained as the existing upload rather than uploaded again.

After upload, the file may be queued, extracting, validating, processing, done, rejected or failed. The underwriter must wait for processing to finish before asking a question about it. A stored file with no available rows or document text produces a response telling the user to wait or choose a parsed source.

## 4. Normal portfolio-analysis workflow

The normal workflow is:

1. The underwriter types a question or chooses a prompt.
2. Optional selected upload IDs, a property ID, a hotspot ID and the portfolio ID are attached to the request. File contents are not trusted as instructions.
3. The browser records the question as pending and displays a waiting state: **Furi is checking your question…**
4. The Flask backend validates the request and selects evidence from the database.
5. For a question that needs model output, such as risk, loss, flood, AAL, return period or exposure, the backend reuses the latest open or approved portfolio run. If no run exists, it starts one and places it in review rather than silently treating it as approved.
6. Evidence is assembled from the portfolio, selected uploads, matching rows, document chunks, document facts, named properties, hotspots and available model-run results.
7. The answer provider writes a grounded Markdown response from that evidence.
8. The browser displays the response, sources, citations and any workflow action.

### Evidence used for portfolio questions

Depending on the question, evidence can include:

- Portfolio property count and total insured value
- Breakdown by housing class, review status, hazard source and region
- Highest insured-value properties
- Highest severe-tier proxy-score properties
- AAL and scenario losses from the latest open or approved run
- The highest property AAL values
- A named property and its insured value, construction class, hazard scores, review status and coordinates
- Property-level AAL, 1-in-10, 1-in-100 and 1-in-250 losses, where available
- Annual flood probability and proxy depths, where available
- Selected upload summaries and relevant table rows
- Relevant document chunks and extracted facts
- Matching named flood hotspots
- Workflow status and stage status

Evidence is capped before it is sent to the language model. The model is instructed to say when the evidence does not answer the question instead of inventing a value.

## 5. What the underwriter receives

For every flow available after an answer (results review, offer review, map, PDF, follow-ups), see [chat-after-answer-flows.md](chat-after-answer-flows.md).

A completed assistant response normally includes:

- A direct answer followed by short Markdown sections and bullets
- Key figures formatted in KES
- A distinction between supplied data, proxy scores, assumptions, draft results and approved results
- The source used, such as an upload filename or the portfolio/workflow database
- Citations to files, pages, rows, properties, hotspots or model runs where available
- A **Sources used** expandable section
- A response action area

Answers are normally kept below approximately 250 words unless the question requests detail. Long answers can be collapsed or expanded with **Read full answer** / **Show less**.

### Response actions

The response may offer:

- **View portfolio results**: open the workflow panel.
- **Review results**: open a portfolio run waiting for approval.
- **View offer review**: open the single-offer workflow.
- **Download report** or **Download PDF**: create a PDF analyst briefing.
- **View map**: open the map panel.

The generated PDF is a focused analyst briefing. It contains the question, the answer's relevant analysis, and a short **Items requiring attention** section only when a placement check is warning, blocked or awaiting human review. Completed placement checks are not repeated because their relevant facts are already in the answer. The report includes up to six source references and the required human-review limitation. It is labelled **AI-GENERATED ANALYSIS | HUMAN REVIEW REQUIRED**.

## 6. Portfolio model runs and approval

A question that needs portfolio model output can trigger a model run if no open or approved run exists. The run calculates through the portfolio workflow:

1. Check uploaded data, locations and values.
2. Convert flood scenario scores into proxy intensity/depth.
3. Apply construction-class damage functions.
4. Join confirmed properties and exposure values.
5. Calculate property and aggregate losses by scenario.
6. Produce key insights for the chatbot and workflow.
7. Stop at the human review gate.
8. Publish approved results only after approval.

A run in `review` status is a draft. The chatbot must describe it as awaiting human approval. The underwriter reviews the sources, assumptions, synthetic records, limitations and calculated summary in the Workflow panel.

Only after approval are the model outputs considered approved results. The workflow can then expose the loss table, EP curve, AAL and risk briefing as final results. An unapproved run must not be treated as an underwriting decision.

## 7. Placement-offer workflow

A long pasted placement offer is treated as a separate workflow from portfolio analysis. The backend recognises a pasted offer when it is at least 800 characters and contains at least four placement-related terms, such as placement, broker, insured, TIV, deductible, premium, coverage or loss history.

### 7.1 What to enter

Paste the placement memorandum, broker submission or offer text directly into the chat box. A useful offer should include, where available:

- Reference
- Broker and client
- Address or location
- GPS coordinates
- Class of business and coverage type
- Policy term and expiry
- Construction type and year built
- Floors and basement levels
- Gross, ground-floor and basement areas
- TIV or sum insured
- Premium, deductible and flood limit
- Drainage design return period
- Distance to a river and river elevation
- Flood statements and loss history
- Critical plant or equipment in basements

An uploaded PDF, DOCX or text file can also become an offer if its extracted text matches the placement-offer pattern. Select only that offer document for the question.

### 7.2 Privacy handling

Before AI interpretation, the backend redacts detected personal names, email addresses and phone numbers from the offer text. Company names remain because they can matter for underwriting context. The response source is labelled as having contact details redacted.

The underwriter should still use synthetic or redacted material only.

### 7.3 Checks returned

The offer review returns seven stages:

1. **Data extraction**: facts found, coordinates, insured value and construction classification.
2. **Hazard intensity**: five scenario susceptibility scores converted into proxy depths. These are not measured flood depths.
3. **Vulnerability**: construction-class damage ratios, including warnings for model limitations such as basements or high-rise buildings.
4. **Financial loss**: AAL range, 1-in-100 loss, 1-in-250 loss and scenario building losses when both hazard and TIV are available.
5. **Portfolio accumulation**: blocked by default for a single offer. It is only calculated when the underwriter explicitly asks to compare the offer with nearby insured properties.
6. **Underwriting checks**: rule-based findings and their severity.
7. **Human review**: always waiting for the underwriter; no cover or portfolio asset is approved.

Stage statuses are:

- `complete`: the check ran successfully.
- `warning`: the check ran but needs attention.
- `blocked`: required data or a model reference was unavailable.
- `review`: a human decision is required.

Possible findings include:

- Missing coordinates
- Coordinates outside the Nairobi model area
- Approximate hazard estimate
- No hazard reference data
- Broker flood statement conflicting with the model
- Clean flood history being weak evidence
- Basement exposure not modelled
- Critical plant below ground
- High-rise outside the calibrated range
- Drainage designed below the modelled scenarios
- Implausible elevation claim
- Flood limit compared with modelled loss
- Expired offer or short deadline
- Missing insured value

### 7.4 Offer follow-up questions

After a pasted or uploaded offer is reviewed, the offer remains the active chat subject. The composer shows **Reviewing one offer** and the offer name. Follow-up questions can include:

- `What should I verify with the broker?`
- `Explain the basement exposure.`
- `What is the modelled 1-in-100 loss?`
- `What deductible issue should I review?`
- `Compare this offer's accumulation with nearby insured properties.`

The follow-up carries only `offerText` for a pasted offer or `offerUploadId` for an uploaded offer. Portfolio CSVs are not silently mixed into the offer review. If the underwriter explicitly requests an accumulation comparison, the backend performs that separate comparison within a 1 km radius and reports the run status.

The underwriter can click **Clear** beside the active offer to leave offer mode. Selecting other files also clears the active offer context for that question.

## 8. Chat history and continuity

The chatbot supports:

- **Chats**: open the recent-chat drawer.
- **New** / **New analysis**: start a fresh conversation.
- Reopening a recent conversation.
- Deleting a recent conversation.
- Retaining an unfinished input draft for the active chat.
- Restoring the active chat after a page refresh.
- Retrying a request when the page refreshed before its answer was saved.

Up to 12 recent conversations are kept in browser storage. The chat title is the first user question, truncated to 52 characters. The current browser implementation persists conversation messages and active offer context locally; the separate `/chats` API exists but the visible chat panel does not use it for this history display.

If the browser refreshes while a request is pending, the user sees that the page refreshed before the answer was saved and can press **Retry**. A retry uses the original request context.

## 9. Error and unavailable states

The underwriter may see an error response when:

- The message is empty.
- More than five files are selected.
- A file is not in the current portfolio.
- A carried offer is missing, invalid, too long or mixed with another source.
- An offer document has not finished processing or contains no usable placement text.
- A portfolio or model run cannot be found.
- A selected upload has no processed rows or document text yet.
- The backend or data source is unavailable.

If all configured language-model providers fail, normal portfolio chat still returns a data-only summary and states that AI models are unavailable. Offer review also returns the deterministic offer briefing without the additional AI interpretation. The response identifies the provider as unavailable rather than hiding the limitation.

The provider order is Claude first, then Gemini, then OpenAI. The server-side OpenAI key must be configured as `OPENAI_API_KEY`; it must never be exposed through a `VITE_` browser variable. The configured model may be supplied through the backend's OpenAI model setting.

## 10. Underwriter responsibilities

Before relying on a response, the underwriter should:

- Confirm the source file, page, row or property behind important claims.
- Check whether figures are proxy, assumed, draft or approved.
- Review rows with validation issues or low-confidence enrichment.
- Confirm coordinates, construction class, TIV and valuation basis.
- Treat missing, approximate or interpolated hazard data as a limitation.
- Review basement plant, high-rise exposure, business interruption and exclusions separately.
- Confirm the broker's terms, deductible, limits, expiry and loss history.
- Obtain human approval for portfolio model runs.
- Make the underwriting and coverage decision outside the chatbot.

## 11. What Furika does not do

Furika does not:

- Approve or bind cover.
- Automatically confirm AI-extracted buildings from documents.
- Treat a draft model run as approved.
- Use a portfolio's insured properties as the subject of a single-offer review unless comparison is explicitly requested.
- Invent a flood depth, loss, approval or missing value.
- Treat an uploaded document's instructions as system instructions.
- Replace document review, broker clarification, catastrophe modelling review or underwriting authority.
- Provide OCR-quality certainty for a scanned PDF; values without a verifiable text layer require review.

## 12. Request and response reference

The visible chatbot sends `POST /api/v1/chat` with a request shaped like:

```json
{
  "message": "Explain the risk for NBO-0002.",
  "mode": "analysis",
  "context": {
    "portfolioId": "SYN-PORT-142",
    "propertyId": "NBO-0002",
    "uploadIds": ["upload-123"]
  }
}
```

Relevant context fields are:

- `portfolioId`: portfolio being analysed.
- `propertyId`: property to prioritise.
- `hotspotId`: reference hotspot to prioritise.
- `runId`: workflow run, used when asking from a workflow stage.
- `uploadIds`: up to five selected source IDs.
- `offerText`: one carried pasted placement offer.
- `offerUploadId`: one carried uploaded placement document.

A response can contain:

- `answer`: rendered Markdown answer.
- `asset`: offer location and model summary for map display, when available.
- `source`: source label shown in the chat.
- `citations`: files, pages, rows, properties, hotspots and runs supporting the answer.
- `actions`: available backend actions, such as opening the workflow.
- `workflow`: portfolio run ID, status and whether it was created by this question.
- `offerChecks`: the seven-stage single-offer review.
- `provider` and `model`: language-model provider metadata.

## 13. Short operating example

1. Open **Furika Bot**.
2. Select **Add file**, choose **Upload new**, select **Synthetic data** or **Redacted data**, and upload the placement memorandum.
3. Wait until the file is processed.
4. Select the file under **Saved files**.
5. Ask: `Review this placement offer for flood risk, model limitations and underwriting concerns.`
6. Read the response and open **View offer review**.
7. Inspect all seven stages, especially blocked and warning stages.
8. Ask follow-ups while the offer banner is active.
9. Use **Download PDF** for an analyst briefing if required.
10. Make the underwriting decision separately. The tool will not approve the offer for you.

## 14. Three clicks to anything that matters

Every core task is reachable in three clicks or fewer from the screen that opens after sign-in (Furika Bot). Typing a question is not counted as a click.

| Task | Clicks | Path |
|---|---|---|
| See the portfolio bottom line and what to check | 1 | Results banner at the top of the chat: **View results**, **Review** or **Calculate** |
| Approve or send back a run | 2 | **Review** → **Approve** / **Send back** at the top of the Summary |
| Start a new portfolio calculation | 2 | **Calculate** (or **View results**) → **Calculate portfolio** |
| Open the map | 1 | **Map** in the chat header |
| Ask about a property on the map | 3 | **Map** → property pin → ask action |
| Ask about a property from the list | 3 | **Portfolio** → the property → **Ask** in its details |
| See ground-up, gross and net loss | 3 | **View results** → **Pipeline** → **Financial engine** |
| See every figure behind a result | 2 | **View results** → **All figures behind this** |
| Review a pasted offer | 1 | Paste the offer and send → **View offer review** |
| Upload a file from the chat | 3 | **Add file** → data type (remembered after the first time) → choose the file |
| Reopen an earlier conversation | 2 | **Chats** → the conversation |

The results banner stays pinned at the top of the chat thread and changes with the run: red when a run is waiting for your decision, green when results are approved, grey when nothing has been calculated yet.
