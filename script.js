const STORAGE_KEY = "fusion_storyboard_os_projects";
const SCHEMA_VERSION = 5;
const LAST_GOOD_KEY = "fusion_storyboard_os_last_good_projects";
const IMAGE_DB_NAME = "fusion_storyboard_os_images";
const IMAGE_STORE_NAME = "reference_images";
const IMAGE_DB_VERSION = 1;
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_FOLDER_KEY = "fusion_storyboard_drive_folder_id";
const DRIVE_LAST_FILE_ID_KEY = "fusion_storyboard_last_drive_file_id";
const DRIVE_LAST_FILE_NAME_KEY = "fusion_storyboard_last_drive_file_name";
const DRIVE_AUTO_SAVE_KEY = "fusion_storyboard_drive_auto_save";
const DRIVE_SESSION_KEY = "fusion_storyboard_current_drive_file";
const DRIVE_PACKAGE_MIME = "application/zip";
const DRIVE_RESUMABLE_THRESHOLD = 5 * 1024 * 1024;

const OPTIONS = {
  projectTypes: ["Product Video", "Food / Cafe Video", "Brand Story", "Interview", "Reels / Shorts", "Commercial Photography", "Other"],
  platforms: ["Instagram Reels", "YouTube Shorts", "YouTube", "Xiaohongshu", "Website", "Ads", "Client Proposal", "Internal Planning"],
  aspectRatios: ["9:16", "16:9", "1:1", "4:5"],
  projectStatuses: ["Planning", "Ready to Shoot", "Shooting", "Editing", "Delivered", "Archived"],
  shotSizes: ["Extreme Wide", "Wide", "Medium", "Close-up", "Extreme Close-up", "Top Shot", "Detail Shot", "POV", "Over Shoulder"],
  lenses: ["16mm", "24mm", "35mm", "50mm", "85mm", "100mm Macro", "70-200mm", "Custom"],
  movements: ["Static", "Push In", "Pull Out", "Pan", "Tilt", "Slide", "Handheld", "Gimbal", "Slow Motion", "Macro Movement", "Transition Shot"],
  purposes: ["Establishing", "Product Beauty", "Product Detail", "Process", "Human Story", "Brand Mood", "Transition", "Selling Point", "Hook", "Ending", "B-roll", "Interview", "Social Proof"],
  shotStatuses: ["Not Shot", "Shot", "Need Reshoot", "Optional", "Removed"],
  priorities: ["Must Have", "Good to Have", "Optional"],
  referenceTypes: ["Moodboard", "Location Photo", "Hand Sketch", "AI Generated Image", "Previous Work", "Client Reference"]
};

const PDF_VERSIONS = {
  client: {
    title: "Client Proposal Version",
    fields: [["Shot Purpose", "shotPurpose"], ["Brand Focus", "productOrBrandFocus"], ["Notes", "notes"]]
  },
  director: {
    title: "Director Version",
    fields: [["Shot Size", "shotSize"], ["Lens", "lens"], ["Camera Movement", "cameraMovement"], ["Lighting Mood", "lightingMood"], ["Sound", "soundNotes"], ["Post Notes", "postProductionNotes"]]
  },
  production: {
    title: "Production Version",
    fields: [["Location", "location"], ["Shoot Time", "shootTime"], ["Props", "props"], ["Status", "status"], ["Priority", "priority"], ["Must Have", (shot) => shot.isMustHave || shot.priority === "Must Have" ? "Yes" : "No"], ["Needs Art Prep", (shot) => shot.needsArtDirection ? "Yes" : "No"], ["Needs Audio", (shot) => shot.needsAudioRecording ? "Yes" : "No"]]
  },
  editor: {
    title: "Editor Version",
    fields: [["Shot Purpose", "shotPurpose"], ["Sound Notes", "soundNotes"], ["Voice / VO", "voiceOverNotes"], ["Music Mood", "musicMood"], ["Post Notes", "postProductionNotes"], ["Caption Idea", "captionIdea"]]
  }
};

let projects = [];
let currentProjectId = null;
let editingProjectId = null;
let editingShotId = null;
let currentView = "card";
let currentSequenceId = "master";
let pendingReferenceImages = [];
let draggedShotId = null;
let draggedSequenceRefId = null;
let imageDb = null;
let imageDbAvailable = false;
let imageObjectUrls = new Map();
let driveAccessToken = "";
let driveTokenClient = null;
let currentDriveFile = null;
let driveChangesPending = false;
let driveUploadInProgress = false;
let driveAutoSaveTimer = null;
let conflictDialogResolver = null;
let unsavedDialogResolver = null;
let driveStatusState = "disconnected";
let driveStatusMessage = "Drive Disconnected";
let driveTokenExpiresAt = 0;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => {
    console.error(error);
    alert(`Fusion Storyboard OS could not finish startup: ${error.message}`);
  });
});

async function init() {
  hydrateSelects();
  bindEvents();
  restoreDriveSession();
  initializeDrivePreferences();
  await initImageDb();
  projects = migrateProjects(loadProjects());
  projects.forEach(ensureProjectSequences);
  await migrateLegacyReferenceImages();
  if (!projects.length) {
    projects = [createDemoProject()];
    saveProjects("Auto-saved");
  }
  render();
  renderDriveControls();
}

function initImageDb() {
  return new Promise((resolve) => {
    if (!("indexedDB" in window)) {
      imageDbAvailable = false;
      alert("IndexedDB is not available in this browser. Reference images cannot be saved. Use Chrome for full image storage support.");
      resolve(false);
      return;
    }

    const request = indexedDB.open(IMAGE_DB_NAME, IMAGE_DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(IMAGE_STORE_NAME)) {
        db.createObjectStore(IMAGE_STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = (event) => {
      imageDb = event.target.result;
      imageDbAvailable = true;
      resolve(true);
    };
    request.onerror = () => {
      imageDbAvailable = false;
      alert("IndexedDB could not be opened. Reference images cannot be saved. Please export a JSON backup and try Chrome.");
      resolve(false);
    };
  });
}

function hydrateSelects() {
  fillSelect($("#projectStatusFilter"), ["", ...OPTIONS.projectStatuses], "All Status");
  fillSelect($("[name='projectType']"), OPTIONS.projectTypes);
  fillSelect($("[name='platforms']"), OPTIONS.platforms);
  fillSelect($("[name='aspectRatio']"), OPTIONS.aspectRatios);
  fillSelect($("[name='status']"), OPTIONS.projectStatuses);
  fillSelect($("#shotForm [name='shotSize']"), OPTIONS.shotSizes);
  fillSelect($("#shotForm [name='lens']"), OPTIONS.lenses);
  fillSelect($("#shotForm [name='cameraMovement']"), OPTIONS.movements);
  fillSelect($("#shotForm [name='status']"), OPTIONS.shotStatuses);
  fillSelect($("#shotForm [name='priority']"), OPTIONS.priorities);
  fillSelect($("#shotForm [name='shotPurpose']"), OPTIONS.purposes);
  fillSelect($("#shotForm [name='platforms']"), OPTIONS.platforms);
  fillSelect($("#shotForm [name='referenceType']"), OPTIONS.referenceTypes);
}

function fillSelect(select, values, firstLabel) {
  if (!select) return;
  select.innerHTML = "";
  values.forEach((value, index) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = index === 0 && firstLabel ? firstLabel : value;
    select.appendChild(option);
  });
}

function bindEvents() {
  $("#newProjectBtn").addEventListener("click", () => openProjectDialog());
  $("#projectForm").addEventListener("submit", saveProjectFromForm);
  $("#shotForm").addEventListener("submit", saveShotFromForm);
  $("#scriptForm").addEventListener("submit", handleScriptGenerate);
  $("#projectSearch").addEventListener("input", renderProjects);
  $("#projectStatusFilter").addEventListener("change", renderProjects);
  $("#homeBtn").addEventListener("click", showProjectList);
  $("#editProjectBtn").addEventListener("click", () => openProjectDialog(currentProject()));
  $("#newShotBtn").addEventListener("click", () => openShotDialog());
  $("#cardViewBtn").addEventListener("click", () => setView("card"));
  $("#listViewBtn").addEventListener("click", () => setView("list"));
  $("#shootModeBtn").addEventListener("click", () => setView("shoot"));
  $("#renumberBtn").addEventListener("click", renumberShots);
  $("#exportPdfBtn").addEventListener("click", exportPDF);
  $("#exportCsvBtn").addEventListener("click", exportCSV);
  $("#exportJsonBtn").addEventListener("click", exportJSON);
  $("#exportPackageBtn").addEventListener("click", openPackageExportDialog);
  $("#exportCurrentPackageBtn").addEventListener("click", () => exportProjectPackage("current"));
  $("#exportAllPackageBtn").addEventListener("click", () => exportProjectPackage("all"));
  $("#importJsonInput").addEventListener("change", importJSON);
  $("#importPackageInput").addEventListener("change", importProjectPackage);
  $("#connectDriveBtn").addEventListener("click", connectGoogleDrive);
  $("#disconnectDriveBtn").addEventListener("click", disconnectGoogleDrive);
  $("#openDriveBtn").addEventListener("click", openDriveBrowser);
  $("#saveDriveBtn").addEventListener("click", () => saveToDrive());
  $("#saveAsDriveBtn").addEventListener("click", () => saveAsNewDriveFile());
  $("#driveAutoSaveToggle").addEventListener("change", updateDriveAutoSavePreference);
  $("#createDriveFolderBtn").addEventListener("click", createDefaultDriveFolder);
  $("#chooseDriveFolderBtn").addEventListener("click", chooseExistingDriveFolder);
  $("#pickDriveFileBtn").addEventListener("click", pickDriveProjectFile);
  $("#refreshDriveFilesBtn").addEventListener("click", refreshDriveFileList);
  $$('[data-conflict-action]').forEach((button) => button.addEventListener("click", () => resolveConflictDialog(button.dataset.conflictAction)));
  $$('[data-unsaved-action]').forEach((button) => button.addEventListener("click", () => resolveUnsavedDialog(button.dataset.unsavedAction)));
  $("#scriptToolBtn").addEventListener("click", () => $("#scriptDialog").showModal());
  $("#generatePromptInFormBtn").addEventListener("click", fillPromptInForm);
  $("#callSheetBtn").addEventListener("click", showCallSheet);
  $("#copyCallSheetBtn").addEventListener("click", copyCallSheet);
  $("#printCallSheetBtn").addEventListener("click", exportPDF);
  $("#optimizeBtn").addEventListener("click", showOptimizedOrder);
  $("#referenceImageInput").addEventListener("change", handleReferenceUpload);
  ["#filterStatus", "#filterPriority", "#filterLocation", "#filterPurpose", "#filterMustHave", "#filterHook", "#filterProps"].forEach((selector) => {
    $(selector).addEventListener("input", renderProjectDetail);
    $(selector).addEventListener("change", renderProjectDetail);
  });
  $("#clearFiltersBtn").addEventListener("click", clearShotFilters);
  $("#applyBatchBtn").addEventListener("click", applyBatchActions);
  $("#nextShotBtn").addEventListener("click", focusNextShootCard);

  $$("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });
  bindImagePreviewDialog();
  window.addEventListener("beforeunload", (event) => {
    if (!driveChangesPending) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

function loadProjects() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    alert("Local data could not be read. A fresh demo project will be loaded.");
    return [];
  }
}

function saveProjects(label = "Local Saved", options = {}) {
  try {
    setSaveStatus("Local Unsaved", "unsaved");
    if (!options.suppressCloudPending) markDriveChangesPending();
    const currentRaw = localStorage.getItem(STORAGE_KEY);
    if (currentRaw) localStorage.setItem(LAST_GOOD_KEY, currentRaw);
    const cleanProjects = stripImageDataFromProjects(migrateProjects(projects));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanProjects));
    setTimeout(() => setSaveStatus(label.startsWith("Local") ? label : `Local ${label}`, "saved"), 150);
    updateStorageHealth();
    return true;
  } catch (error) {
    console.error("Save failed", error);
    setSaveStatus("Local Save Failed", "failed");
    alert("Save failed. Your browser may be out of localStorage space. Please export a JSON backup now before closing this page.");
    return false;
  }
}

function migrateProjects(projectList) {
  return (projectList || []).map((project) => {
    const storyboards = (project.storyboards || []).map((shot, index) => ({
      ...createBlankShot(index + 1),
      ...shot,
      id: shot.id || uid("shot"),
      order: Number.isFinite(Number(shot.order)) ? Number(shot.order) : index + 1,
      referenceImages: (shot.referenceImages || []).map((image) => ({
        id: image.id || uid("ref"),
        fileName: image.fileName || "reference-image.jpg",
        type: image.type || "reference",
        createdAt: image.createdAt || nowIso(),
        indexedDbKey: image.indexedDbKey || "",
        dataUrl: image.dataUrl,
        packagePath: image.packagePath,
        mimeType: image.mimeType
      }))
    }));

    const migrated = {
      schemaVersion: SCHEMA_VERSION,
      id: project.id || uid("project"),
      title: project.title || "Untitled Project",
      clientName: project.clientName || "",
      brandName: project.brandName || "",
      projectType: project.projectType || "Product Video",
      shootingDate: project.shootingDate || "",
      platforms: Array.isArray(project.platforms) ? project.platforms : [],
      aspectRatio: project.aspectRatio || "16:9",
      status: project.status || "Planning",
      notes: project.notes || "",
      createdAt: project.createdAt || nowIso(),
      updatedAt: project.updatedAt || nowIso(),
      storyboards,
      sequences: migrateSequences(project.sequences, storyboards),
      cloudMetadata: migrateCloudMetadata(project.cloudMetadata)
    };

    return migrated;
  });
}

function migrateCloudMetadata(metadata = {}) {
  return {
    provider: "google-drive",
    fileId: metadata.fileId || "",
    fileName: metadata.fileName || "",
    folderId: metadata.folderId || "",
    modifiedTime: metadata.modifiedTime || "",
    lastCloudSaveAt: metadata.lastCloudSaveAt || "",
    cloudStatus: metadata.cloudStatus || ""
  };
}

function migrateSequences(sequences, storyboards) {
  const validShotIds = new Set((storyboards || []).map((shot) => shot.id));
  if (!Array.isArray(sequences) || !sequences.length) {
    return [createDefaultSequence(storyboards)];
  }

  const migrated = sequences.map((sequence, sequenceIndex) => ({
    id: sequence.id || uid("seq"),
    name: sequence.name || `Sequence ${sequenceIndex + 1}`,
    description: sequence.description || "",
    createdAt: sequence.createdAt || nowIso(),
    updatedAt: sequence.updatedAt || nowIso(),
    shotRefs: (sequence.shotRefs || [])
      .filter((ref) => ref && validShotIds.has(ref.shotId))
      .map((ref, refIndex) => ({
        id: ref.id || uid("seqitem"),
        shotId: ref.shotId,
        order: Number.isFinite(Number(ref.order)) ? Number(ref.order) : refIndex + 1,
        sequenceNotes: ref.sequenceNotes || "",
        sequencePurpose: ref.sequencePurpose || "",
        sequenceDuration: ref.sequenceDuration || ""
      }))
  }));

  return migrated.length ? migrated : [createDefaultSequence(storyboards)];
}

function createDefaultSequence(storyboards) {
  return {
    id: uid("seq"),
    name: "Sequence 1",
    description: "Default sequence created from the master shot order.",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    shotRefs: sortedShotList(storyboards).map((shot, index) => ({
      id: uid("seqitem"),
      shotId: shot.id,
      order: index + 1,
      sequenceNotes: "",
      sequencePurpose: "",
      sequenceDuration: ""
    }))
  };
}

function sortedShotList(shots) {
  return [...(shots || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
}

function ensureProjectSequences(project) {
  if (!project) return;
  project.sequences = migrateSequences(project.sequences, project.storyboards || []);
  if (currentSequenceId !== "master" && !project.sequences.some((sequence) => sequence.id === currentSequenceId)) {
    currentSequenceId = "master";
  }
}
function stripImageDataFromProjects(projectList) {
  return projectList.map((project) => ({
    ...project,
    storyboards: (project.storyboards || []).map((shot) => ({
      ...shot,
      referenceImages: (shot.referenceImages || []).map(({ dataUrl, blob, objectUrl, ...metadata }) => metadata)
    }))
  }));
}

function setSaveStatus(text, className) {
  const status = $("#saveStatus");
  status.textContent = text;
  status.className = `save-status ${className || ""}`;
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function currentProject() {
  return projects.find((project) => project.id === currentProjectId);
}

function sortedShots(project = currentProject()) {
  return [...(project?.storyboards || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
}

function currentSequence(project = currentProject()) {
  if (!project || currentSequenceId === "master") return null;
  ensureProjectSequences(project);
  return project.sequences.find((sequence) => sequence.id === currentSequenceId) || null;
}

function currentSequenceName(project = currentProject()) {
  return currentSequence(project)?.name || "All Shots";
}

function sequenceShotEntries(project = currentProject(), sequence = currentSequence(project)) {
  if (!project || !sequence) return sortedShots(project).map((shot) => ({ shot, ref: null }));
  const shotMap = new Map((project.storyboards || []).map((shot) => [shot.id, shot]));
  return [...(sequence.shotRefs || [])]
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((ref) => ({ ref, shot: shotMap.get(ref.shotId) }))
    .filter((entry) => entry.shot);
}

function baseShotsForCurrentView(project = currentProject()) {
  return sequenceShotEntries(project).map((entry) => entry.ref ? { ...entry.shot, __sequenceRefId: entry.ref.id } : entry.shot);
}

function sequenceRefForShot(shotId, project = currentProject()) {
  const sequence = currentSequence(project);
  if (!sequence) return null;
  return (sequence.shotRefs || []).find((ref) => ref.shotId === shotId) || null;
}

function renderSequenceTabs(project = currentProject()) {
  const bar = $("#sequenceBar");
  if (!bar || !project) return;
  ensureProjectSequences(project);
  const sequenceButtons = project.sequences.map((sequence) => `
    <button class="sequence-tab ${currentSequenceId === sequence.id ? "active" : ""}" data-sequence-id="${sequence.id}" type="button">${escapeHTML(sequence.name)}</button>`).join("");
  const isMaster = currentSequenceId === "master";
  bar.innerHTML = `
    <div class="sequence-tabs">
      <button class="sequence-tab ${isMaster ? "active" : ""}" data-sequence-id="master" type="button">All Shots</button>
      ${sequenceButtons}
      <button class="sequence-tab add" data-sequence-action="new" type="button">+ New Sequence</button>
    </div>
    <div class="sequence-actions">
      <span class="tag">Current Sequence: ${escapeHTML(currentSequenceName(project))}</span>
      ${!isMaster ? `<button class="ghost" data-sequence-action="rename" type="button">Rename</button>
      <button class="ghost" data-sequence-action="duplicate" type="button">Duplicate</button>
      <button class="ghost" data-sequence-action="add-existing" type="button">Add Existing Shot</button>
      <button class="danger" data-sequence-action="delete" type="button">Delete Sequence</button>` : ""}
    </div>`;
  bar.querySelectorAll("[data-sequence-id]").forEach((button) => button.addEventListener("click", () => {
    currentSequenceId = button.dataset.sequenceId;
    renderProjectDetail();
  }));
  bar.querySelectorAll("[data-sequence-action]").forEach((button) => button.addEventListener("click", handleSequenceAction));
}

function handleSequenceAction(event) {
  const action = event.currentTarget.dataset.sequenceAction;
  if (action === "new") createSequence();
  if (action === "rename") renameSequence();
  if (action === "duplicate") duplicateSequence();
  if (action === "delete") deleteSequence();
  if (action === "add-existing") openSequencePicker();
}

function createSequence() {
  const project = currentProject();
  ensureProjectSequences(project);
  const name = prompt("Sequence name", `Sequence ${project.sequences.length + 1}`);
  if (!name) return;
  const sequence = {
    id: uid("seq"),
    name: name.trim(),
    description: "",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    shotRefs: []
  };
  project.sequences.push(sequence);
  project.updatedAt = nowIso();
  currentSequenceId = sequence.id;
  if (saveProjects()) renderProjectDetail();
}

function renameSequence() {
  const sequence = currentSequence();
  if (!sequence) return;
  const name = prompt("Rename sequence", sequence.name);
  if (!name) return;
  sequence.name = name.trim();
  sequence.updatedAt = nowIso();
  currentProject().updatedAt = nowIso();
  if (saveProjects()) renderProjectDetail();
}

function duplicateSequence() {
  const project = currentProject();
  const sequence = currentSequence(project);
  if (!sequence) return;
  const copy = {
    ...JSON.parse(JSON.stringify(sequence)),
    id: uid("seq"),
    name: `${sequence.name} Copy`,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    shotRefs: (sequence.shotRefs || []).map((ref, index) => ({ ...ref, id: uid("seqitem"), order: index + 1 }))
  };
  project.sequences.push(copy);
  project.updatedAt = nowIso();
  currentSequenceId = copy.id;
  if (saveProjects()) renderProjectDetail();
}

function deleteSequence() {
  const project = currentProject();
  const sequence = currentSequence(project);
  if (!sequence) return;
  if (!confirm(`Delete sequence "${sequence.name}"? Master shots will not be deleted.`)) return;
  project.sequences = project.sequences.filter((item) => item.id !== sequence.id);
  project.updatedAt = nowIso();
  currentSequenceId = "master";
  if (saveProjects()) renderProjectDetail();
}

function addShotToSequence(shotId, sequenceId, allowDuplicate = false) {
  const project = currentProject();
  ensureProjectSequences(project);
  const sequence = project.sequences.find((item) => item.id === sequenceId);
  if (!sequence) return false;
  if (!allowDuplicate && sequence.shotRefs.some((ref) => ref.shotId === shotId)) return false;
  sequence.shotRefs.push({
    id: uid("seqitem"),
    shotId,
    order: sequence.shotRefs.length + 1,
    sequenceNotes: "",
    sequencePurpose: "",
    sequenceDuration: ""
  });
  sequence.updatedAt = nowIso();
  project.updatedAt = nowIso();
  return true;
}

function addShotToSequencePrompt(shotId) {
  const project = currentProject();
  ensureProjectSequences(project);
  if (!project.sequences.length) createSequence();
  const menu = project.sequences.map((sequence, index) => `${index + 1}. ${sequence.name}`).join("\n");
  const answer = prompt(`Add shot to which sequence?\n\n${menu}\n\nType a number. Add ! after the number to add duplicate reference.`, "1");
  if (!answer) return;
  const allowDuplicate = answer.trim().endsWith("!");
  const index = Number.parseInt(answer, 10) - 1;
  const sequence = project.sequences[index];
  if (!sequence) return alert("Invalid sequence number.");
  const added = addShotToSequence(shotId, sequence.id, allowDuplicate);
  if (!added) return alert("This shot is already in that sequence. Type ! after the number to add a duplicate reference.");
  if (saveProjects()) renderProjectDetail();
}

function removeShotFromCurrentSequence(shotId, refId) {
  const project = currentProject();
  const sequence = currentSequence(project);
  if (!sequence) return;
  sequence.shotRefs = sequence.shotRefs.filter((ref) => ref.id !== refId && !(ref.shotId === shotId && !refId));
  sequence.shotRefs.forEach((ref, index) => ref.order = index + 1);
  sequence.updatedAt = nowIso();
  project.updatedAt = nowIso();
  if (saveProjects()) renderProjectDetail();
}

function openSequencePicker() {
  const project = currentProject();
  const sequence = currentSequence(project);
  if (!sequence) return;
  const list = $("#sequencePickerList");
  list.innerHTML = sortedShots(project).map((shot) => {
    const already = sequence.shotRefs.some((ref) => ref.shotId === shot.id);
    return `<div class="sequence-picker-row">
      <div><strong>${escapeHTML(shot.shotNumber)}</strong> ${escapeHTML(shot.scene || "Untitled scene")}<span>${escapeHTML(shot.description || "")}</span></div>
      <button class="${already ? "ghost" : "primary"}" data-picker-shot="${shot.id}" type="button">${already ? "Add duplicate reference" : "Add"}</button>
    </div>`;
  }).join("");
  list.querySelectorAll("[data-picker-shot]").forEach((button) => button.addEventListener("click", () => {
    const allowDuplicate = sequence.shotRefs.some((ref) => ref.shotId === button.dataset.pickerShot);
    addShotToSequence(button.dataset.pickerShot, sequence.id, allowDuplicate);
    if (saveProjects()) {
      $("#sequencePickerDialog").close();
      renderProjectDetail();
    }
  }));
  $("#sequencePickerDialog").showModal();
}
function render() {
  if (currentProjectId) renderProjectDetail();
  else renderProjects();
}

function renderProjects() {
  $("#projectListView").classList.remove("hidden");
  $("#projectDetailView").classList.add("hidden");
  $("#homeBtn").classList.add("hidden");

  const query = $("#projectSearch").value.trim().toLowerCase();
  const filter = $("#projectStatusFilter").value;
  const visible = projects.filter((project) => {
    const haystack = `${project.title} ${project.clientName} ${project.brandName} ${project.projectType}`.toLowerCase();
    return (!query || haystack.includes(query)) && (!filter || project.status === filter);
  });

  $("#projectGrid").innerHTML = visible.length ? visible.map(projectCardHTML).join("") : `<div class="empty">No projects found.</div>`;
  $$("#projectGrid [data-action]").forEach((button) => button.addEventListener("click", handleProjectAction));
}

function projectCardHTML(project) {
  const shotCount = project.storyboards.length;
  const mustCount = project.storyboards.filter((shot) => shot.isMustHave || shot.priority === "Must Have").length;
  return `
    <article class="project-card">
      <div>
        <p class="eyebrow">${escapeHTML(project.projectType || "Project")}</p>
        <h3>${escapeHTML(project.title)}</h3>
        <p>${escapeHTML(project.clientName || "No client")} · ${escapeHTML(project.brandName || "No brand")}</p>
      </div>
      <div class="tag-row">
        <span class="tag">${escapeHTML(project.status)}</span>
        <span class="tag">${escapeHTML(project.aspectRatio)}</span>
        <span class="tag">${shotCount} shots</span>
        <span class="tag must">${mustCount} must</span>
      </div>
      <p>${escapeHTML(project.notes || "No notes yet.")}</p>
      <div class="project-actions">
        <button class="primary" data-action="open" data-id="${project.id}" type="button">Open</button>
        <button class="ghost" data-action="edit" data-id="${project.id}" type="button">Edit</button>
        <button class="danger" data-action="delete" data-id="${project.id}" type="button">Delete</button>
      </div>
    </article>`;
}

function handleProjectAction(event) {
  const { action, id } = event.currentTarget.dataset;
  const project = projects.find((item) => item.id === id);
  if (action === "open") {
    currentProjectId = id;
    currentSequenceId = "master";
    ensureProjectSequences(project);
    syncDriveFileForProject(project);
    renderProjectDetail();
  }
  if (action === "edit") openProjectDialog(project);
  if (action === "delete" && confirm(`Delete "${project.title}"?`)) {
    projects = projects.filter((item) => item.id !== id);
    if (saveProjects()) renderProjects();
  }
}

function showProjectList() {
  currentProjectId = null;
  currentSequenceId = "master";
  renderProjects();
}

function openProjectDialog(project) {
  editingProjectId = project?.id || null;
  $("#projectDialogTitle").textContent = project ? "Edit Project" : "New Project";
  const form = $("#projectForm");
  form.reset();
  const data = project || {
    title: "",
    clientName: "",
    brandName: "",
    projectType: "Product Video",
    shootingDate: "",
    platforms: ["Instagram Reels", "YouTube Shorts", "YouTube", "Xiaohongshu", "Website", "Ads", "Client Proposal", "Internal Planning"],
    aspectRatio: "16:9",
    status: "Planning",
    notes: ""
  };
  setFormValues(form, data);
  $("#projectDialog").showModal();
}

function saveProjectFromForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = getFormValues(form);
  const timestamp = nowIso();

  if (editingProjectId) {
    const project = projects.find((item) => item.id === editingProjectId);
    Object.assign(project, data, { updatedAt: timestamp });
  } else {
    projects.unshift({
      id: uid("project"),
      ...data,
      createdAt: timestamp,
      updatedAt: timestamp,
      storyboards: []
    });
  }
  if (saveProjects()) {
    form.closest("dialog").close();
    render();
  }
}

function renderProjectDetail() {
  const project = currentProject();
  if (!project) return showProjectList();
  $("#projectListView").classList.add("hidden");
  $("#projectDetailView").classList.remove("hidden");
  $("#homeBtn").classList.remove("hidden");
  $("#projectTitle").textContent = project.title;
  $("#projectMeta").textContent = `${project.projectType} · ${project.status} · ${project.aspectRatio}`;
  $("#projectSubtitle").textContent = `${project.clientName || "No client"} / ${project.brandName || "No brand"} · ${project.shootingDate || "No shooting date"} · ${project.platforms.join(", ")}`;
  ensureProjectSequences(project);
  renderSequenceTabs(project);
  hydrateShotFilters(project);
  renderDashboard(project);
  updateStorageHealth();
  renderShots(project);
  renderDriveControls();
}

function updateStorageHealth() {
  const panel = $("#storageHealth");
  if (!panel) return;
  let textSize = 0;
  try {
    textSize = new Blob([localStorage.getItem(STORAGE_KEY) || ""]).size;
  } catch (error) {
    panel.innerHTML = `<span class="tag reshoot">Storage check failed</span>`;
    return;
  }
  const kb = Math.round(textSize / 1024);
  const imageStatus = imageDbAvailable ? "IndexedDB images ready" : "IndexedDB unavailable";
  const statusClassName = imageDbAvailable ? "shot" : "reshoot";
  panel.innerHTML = `
    <span class="tag">Text data: ${kb} KB</span>
    <span class="tag ${statusClassName}">${imageStatus}</span>
    <span class="tag">Schema V${SCHEMA_VERSION}</span>
    <span class="hint">Use Export Package before moving browsers or computers.</span>`;
}

function hydrateShotFilters(project) {
  fillSelectWithCurrent($("#filterStatus"), ["", ...OPTIONS.shotStatuses], "All Status");
  fillSelectWithCurrent($("#filterPriority"), ["", ...OPTIONS.priorities], "All Priority");
  fillSelectWithCurrent($("#filterPurpose"), ["", ...OPTIONS.purposes], "All Purposes");
  const locations = unique((project.storyboards || []).map((shot) => shot.location).filter(Boolean)).sort();
  fillSelectWithCurrent($("#filterLocation"), ["", ...locations], "All Locations");
}

function fillSelectWithCurrent(select, values, firstLabel) {
  if (!select) return;
  const current = select.value;
  fillSelect(select, values, firstLabel);
  if (values.includes(current)) select.value = current;
}

function renderDashboard(project) {
  const shots = baseShotsForCurrentView(project);
  const count = (predicate) => shots.filter(predicate).length;
  const byShotSize = groupCount(shots, "shotSize");
  const byLocation = groupCount(shots, "location");
  const byPurpose = groupCount(shots, "shotPurpose");
  const metrics = [
    ["Total Shots", shots.length],
    ["Must Have", count((s) => s.isMustHave || s.priority === "Must Have")],
    ["Shot", count((s) => s.status === "Shot")],
    ["Not Shot", count((s) => s.status === "Not Shot")],
    ["Need Reshoot", count((s) => s.status === "Need Reshoot")],
    ["Hook", count((s) => s.isHook || s.shotPurpose === "Hook")],
    ["Product Focus", count((s) => /product|coffee|brand|detail|beauty/i.test(`${s.shotPurpose} ${s.productOrBrandFocus}`))],
    ["Shot Sizes", compactSummary(byShotSize)],
    ["Locations", compactSummary(byLocation)],
    ["Purposes", compactSummary(byPurpose)]
  ];
  $("#dashboard").innerHTML = `<div class="metric sequence-current"><strong>${escapeHTML(currentSequenceName(project))}</strong><span>Current Sequence</span></div>` + metrics.map(([label, value]) => `<div class="metric"><strong>${escapeHTML(String(value))}</strong><span>${escapeHTML(label)}</span></div>`).join("");
}

function groupCount(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || "Unset";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function compactSummary(obj) {
  return Object.entries(obj).slice(0, 3).map(([key, value]) => `${key}: ${value}`).join(" · ") || "0";
}

function renderShots(project) {
  const shots = filteredShots(project);
  $("#shotCards").classList.toggle("hidden", currentView !== "card");
  $("#shotTableWrap").classList.toggle("hidden", currentView !== "list");
  $("#shootMode").classList.toggle("hidden", currentView !== "shoot");
  $("#shootModeTools").classList.toggle("hidden", currentView !== "shoot");

  $("#shotCards").innerHTML = shots.length ? shots.map(shotCardHTML).join("") : `<div class="empty">No shots yet. Add a shot or generate from a script.</div>`;
  $("#shotTableBody").innerHTML = shots.map(shotRowHTML).join("");
  $("#shootMode").innerHTML = shots.length ? shootModeGroupsHTML(shots) : `<div class="empty">No shots match the current filters.</div>`;

  $$("#shotCards [data-action]").forEach((button) => button.addEventListener("click", handleShotAction));
  $$("#shotTableBody [data-status-shot]").forEach((select) => select.addEventListener("change", updateShotStatus));
  $$("#shootMode [data-shoot-status]").forEach((button) => button.addEventListener("click", updateShootModeStatus));
  $$(".shot-card").forEach(bindDragEvents);
  hydrateReferenceImages();
  renderShootProgress(shots);
}

function renderShootProgress(shots) {
  const target = $("#shootProgress");
  if (!target) return;
  const active = shots.filter((shot) => shot.status !== "Removed");
  const shotCount = active.filter((shot) => shot.status === "Shot").length;
  const reshootCount = active.filter((shot) => shot.status === "Need Reshoot").length;
  const mustRemaining = active.filter((shot) => (shot.isMustHave || shot.priority === "Must Have") && shot.status !== "Shot").length;
  const percent = active.length ? Math.round((shotCount / active.length) * 100) : 0;
  target.innerHTML = `
    <strong>${percent}% shot</strong>
    <span>${shotCount}/${active.length} complete</span>
    <span>${reshootCount} reshoot</span>
    <span>${mustRemaining} must-have remaining</span>`;
}

function filteredShots(project = currentProject()) {
  const status = $("#filterStatus")?.value || "";
  const priority = $("#filterPriority")?.value || "";
  const location = $("#filterLocation")?.value || "";
  const purpose = $("#filterPurpose")?.value || "";
  const must = $("#filterMustHave")?.value || "";
  const hook = $("#filterHook")?.value || "";
  const props = ($("#filterProps")?.value || "").trim().toLowerCase();

  return baseShotsForCurrentView(project).filter((shot) => {
    const isMust = Boolean(shot.isMustHave || shot.priority === "Must Have");
    const isHook = Boolean(shot.isHook || shot.shotPurpose === "Hook");
    return (!status || shot.status === status) &&
      (!priority || shot.priority === priority) &&
      (!location || shot.location === location) &&
      (!purpose || shot.shotPurpose === purpose) &&
      (!must || (must === "yes" ? isMust : !isMust)) &&
      (!hook || (hook === "yes" ? isHook : !isHook)) &&
      (!props || String(shot.props || "").toLowerCase().includes(props));
  });
}

function clearShotFilters() {
  ["#filterStatus", "#filterPriority", "#filterLocation", "#filterPurpose", "#filterMustHave", "#filterHook", "#filterProps"].forEach((selector) => {
    const field = $(selector);
    if (field) field.value = "";
  });
  renderProjectDetail();
}

function applyBatchActions() {
  const project = currentProject();
  const shots = filteredShots(project);
  if (!shots.length) {
    alert("No filtered shots to update.");
    return;
  }
  const status = $("#batchStatus").value;
  const location = $("#batchLocation").value.trim();
  const shootTime = $("#batchShootTime").value.trim();
  if (!status && !location && !shootTime) {
    alert("Choose at least one batch action first.");
    return;
  }
  if (!confirm(`Apply batch changes to ${shots.length} filtered shots?`)) return;
  shots.forEach((shot) => {
    if (status) shot.status = status;
    if (location) shot.location = location;
    if (shootTime) shot.shootTime = shootTime;
  });
  project.updatedAt = nowIso();
  if (saveProjects()) {
    $("#batchStatus").value = "";
    $("#batchLocation").value = "";
    $("#batchShootTime").value = "";
    renderProjectDetail();
  }
}

function focusNextShootCard() {
  const nextShot = filteredShots().find((shot) => shot.status === "Not Shot" || shot.status === "Need Reshoot");
  if (!nextShot) {
    alert("No remaining Not Shot or Need Reshoot shots in the current filter.");
    return;
  }
  setView("shoot");
  setTimeout(() => {
    const card = $(`#shootMode [data-shot-id="${CSS.escape(nextShot.id)}"]`);
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      card.classList.add("focus-pulse");
      setTimeout(() => card.classList.remove("focus-pulse"), 1400);
    }
  }, 100);
}

function shotCardHTML(shot) {
  const images = shot.referenceImages || [];
  const sequenceRef = shot.__sequenceRefId ? { id: shot.__sequenceRefId } : sequenceRefForShot(shot.id);
  const inSequence = currentSequenceId !== "master";
  return `
    <article class="shot-card" draggable="true" data-shot-id="${shot.id}" data-seq-ref-id="${sequenceRef?.id || ""}">
      <div class="shot-head">
        <div>
          <div class="shot-number">${escapeHTML(shot.shotNumber)}</div>
          <div class="shot-title">${escapeHTML(shot.scene || "Untitled scene")}</div>
        </div>
        <div class="tag-row">
          <span class="tag ${statusClass(shot.status)}">${escapeHTML(shot.status)}</span>
          ${shot.priority === "Must Have" || shot.isMustHave ? `<span class="tag must">Must</span>` : ""}
          ${shot.isHook ? `<span class="tag hook">Hook</span>` : ""}
        </div>
      </div>
      ${images.length ? `<div class="reference-strip">${images.map(referenceImageHTML).join("")}</div>` : ""}
      <p class="shot-description">${escapeHTML(shot.description || "No description.")}</p>
      <div class="shot-meta">
        <span><b>Size</b> ${escapeHTML(shot.shotSize)}</span>
        <span><b>Lens</b> ${escapeHTML(shot.lens)}</span>
        <span><b>Move</b> ${escapeHTML(shot.cameraMovement)}</span>
        <span><b>Purpose</b> ${escapeHTML(shot.shotPurpose)}</span>
        <span><b>Location</b> ${escapeHTML(shot.location || "-")}</span>
        <span><b>Props</b> ${escapeHTML(shot.props || "-")}</span>
      </div>
      <div class="shot-actions no-print">
        <button class="ghost" data-action="edit" data-id="${shot.id}" type="button">Edit</button>
        <button class="ghost" data-action="duplicate" data-id="${shot.id}" type="button">Duplicate</button>
        <button class="ghost" data-action="prompt" data-id="${shot.id}" type="button">Generate Image Prompt</button>
        <button class="ghost" data-action="add-sequence" data-id="${shot.id}" type="button">Add to Sequence</button>
        ${inSequence ? `<button class="ghost" data-action="remove-sequence" data-id="${shot.id}" data-ref-id="${sequenceRef?.id || ""}" type="button">Remove From Sequence</button>` : ""}
        <button class="ghost" data-action="up" data-id="${shot.id}" data-ref-id="${sequenceRef?.id || ""}" type="button">Up</button>
        <button class="ghost" data-action="down" data-id="${shot.id}" data-ref-id="${sequenceRef?.id || ""}" type="button">Down</button>
        <button class="danger" data-action="delete" data-id="${shot.id}" type="button">Delete</button>
      </div>
      ${shot.aiImagePrompt ? `<p class="hint"><b>AI prompt:</b> ${escapeHTML(shot.aiImagePrompt)}</p>` : ""}
    </article>`;
}

function referenceImageHTML(image) {
  const key = image.indexedDbKey || image.dataUrl || "";
  const src = image.dataUrl || "";
  return `<img class="reference-image" data-preview-image="true" data-file-name="${escapeHTML(image.fileName)}" data-image-key="${escapeHTML(key)}" ${src ? `src="${src}"` : ""} alt="${escapeHTML(image.fileName)}">`;
}

function shootModeCardHTML(shot) {
  const isMust = shot.isMustHave || shot.priority === "Must Have";
  const needsReshoot = shot.status === "Need Reshoot";
  return `
    <article class="shoot-card ${isMust ? "must-shoot" : ""}" data-shot-id="${shot.id}">
      <div class="shoot-head">
        <strong>${escapeHTML(shot.shotNumber)}</strong>
        <span class="tag ${statusClass(shot.status)}">${escapeHTML(shot.status)}</span>
      </div>
      <p>${escapeHTML(shot.description || "No description.")}</p>
      <div class="shoot-meta">
        <span><b>Location</b> ${escapeHTML(shot.location || "-")}</span>
        <span><b>Props</b> ${escapeHTML(shot.props || "-")}</span>
        <span><b>Priority</b> ${escapeHTML(shot.priority)}</span>
        <span><b>Must Have</b> ${isMust ? "Yes" : "No"}</span>
        <span><b>Need Reshoot</b> ${needsReshoot ? "Yes" : "No"}</span>
      </div>
      <div class="shoot-status-buttons no-print">
        <button data-shoot-status="Not Shot" data-id="${shot.id}" type="button">Not Shot</button>
        <button data-shoot-status="Shot" data-id="${shot.id}" type="button">Shot</button>
        <button data-shoot-status="Need Reshoot" data-id="${shot.id}" type="button">Need Reshoot</button>
      </div>
    </article>`;
}

function shootModeGroupsHTML(shots) {
  const groups = shots.reduce((acc, shot) => {
    const key = shot.location || "Location TBD";
    if (!acc[key]) acc[key] = [];
    acc[key].push(shot);
    return acc;
  }, {});
  return Object.entries(groups).map(([location, groupShots]) => `
    <section class="shoot-location-group">
      <h3>${escapeHTML(location)} <span>${groupShots.length} shots</span></h3>
      <div class="shoot-location-grid">${groupShots.map(shootModeCardHTML).join("")}</div>
    </section>`).join("");
}

function shotRowHTML(shot) {
  return `
    <tr>
      <td>${escapeHTML(shot.shotNumber)}</td>
      <td>${escapeHTML(shot.scene)}</td>
      <td>${escapeHTML(shot.description)}</td>
      <td>${escapeHTML(shot.shotSize)}</td>
      <td>${escapeHTML(shot.lens)}</td>
      <td>${escapeHTML(shot.cameraMovement)}</td>
      <td>${escapeHTML(shot.location)}</td>
      <td>${escapeHTML(shot.priority)}</td>
      <td><select data-status-shot="${shot.id}">${OPTIONS.shotStatuses.map((status) => `<option ${status === shot.status ? "selected" : ""}>${status}</option>`).join("")}</select></td>
      <td>${escapeHTML(shot.props)}</td>
      <td>${escapeHTML(shot.notes)}</td>
    </tr>`;
}

function statusClass(status) {
  return {
    "Shot": "shot",
    "Not Shot": "not-shot",
    "Need Reshoot": "reshoot",
    "Optional": "optional"
  }[status] || "";
}

function setView(view) {
  currentView = view;
  $("#cardViewBtn").classList.toggle("active", view === "card");
  $("#listViewBtn").classList.toggle("active", view === "list");
  $("#shootModeBtn").classList.toggle("active", view === "shoot");
  renderProjectDetail();
}

function updateShootModeStatus(event) {
  const shot = currentProject().storyboards.find((item) => item.id === event.currentTarget.dataset.id);
  if (!shot) return;
  shot.status = event.currentTarget.dataset.shootStatus;
  currentProject().updatedAt = nowIso();
  if (saveProjects()) renderProjectDetail();
}

function openShotDialog(shot) {
  editingShotId = shot?.id || null;
  pendingReferenceImages = shot?.referenceImages ? [...shot.referenceImages] : [];
  $("#shotDialogTitle").textContent = shot ? "Edit Shot" : "New Shot";
  const form = $("#shotForm");
  form.reset();
  setFormValues(form, shot || createBlankShot(currentProject().storyboards.length + 1));
  renderReferencePreview();
  $("#shotDialog").showModal();
}

function createBlankShot(order) {
  return {
    shotNumber: formatShotNumber(order),
    scene: "",
    description: "",
    shotSize: "Medium",
    lens: "35mm",
    cameraMovement: "Static",
    estimatedDuration: "3s",
    location: "",
    shootTime: "",
    status: "Not Shot",
    priority: "Good to Have",
    shotPurpose: "B-roll",
    productOrBrandFocus: "",
    platforms: currentProject()?.platforms || [],
    isHook: false,
    isMustHave: false,
    isReplaceable: false,
    soundNotes: "",
    voiceOverNotes: "",
    musicMood: "",
    needsAudioRecording: false,
    props: "",
    background: "",
    lightingMood: "",
    wardrobeOrStyling: "",
    needsArtDirection: false,
    postProductionNotes: "",
    captionIdea: "",
    aiImagePrompt: "",
    referenceImages: [],
    notes: "",
    order
  };
}

function saveShotFromForm(event) {
  event.preventDefault();
  const project = currentProject();
  const data = getFormValues(event.currentTarget);
  data.referenceImages = pendingReferenceImages;
  data.isMustHave = data.priority === "Must Have" || data.isMustHave;

  if (editingShotId) {
    const shot = project.storyboards.find((item) => item.id === editingShotId);
    Object.assign(shot, data);
  } else {
    const newShot = {
      id: uid("shot"),
      ...data,
      order: project.storyboards.length + 1
    };
    project.storyboards.push(newShot);
    if (currentSequenceId !== "master") addShotToSequence(newShot.id, currentSequenceId);
  }
  project.updatedAt = nowIso();
  if (saveProjects()) {
    event.currentTarget.closest("dialog").close();
    renderProjectDetail();
  }
}

function handleShotAction(event) {
  const { action, id } = event.currentTarget.dataset;
  const project = currentProject();
  const shot = project.storyboards.find((item) => item.id === id);
  if (action === "edit") openShotDialog(shot);
  if (action === "duplicate") duplicateShot(shot);
  if (action === "delete" && confirm(`Deleting this master shot will remove it from all sequences. Delete shot ${shot.shotNumber}?`)) deleteShot(id);
  if (action === "add-sequence") addShotToSequencePrompt(id);
  if (action === "remove-sequence") removeShotFromCurrentSequence(id, event.currentTarget.dataset.refId);
  if (action === "prompt") {
    shot.aiImagePrompt = generateImagePrompt(shot, project);
    if (saveProjects()) renderProjectDetail();
  }
  if (action === "up" || action === "down") moveShot(id, action, event.currentTarget.dataset.refId);
}

function duplicateShot(shot) {
  const project = currentProject();
  const copy = JSON.parse(JSON.stringify(shot));
  copy.id = uid("shot");
  copy.shotNumber = `${shot.shotNumber}B`;
  copy.order = project.storyboards.length + 1;
  copy.status = "Not Shot";
  project.storyboards.push(copy);
  project.updatedAt = nowIso();
  if (saveProjects()) renderProjectDetail();
}

function deleteShot(id) {
  const project = currentProject();
  project.storyboards = project.storyboards.filter((shot) => shot.id !== id);
  for (const sequence of project.sequences || []) {
    sequence.shotRefs = (sequence.shotRefs || []).filter((ref) => ref.shotId !== id);
    sequence.shotRefs.forEach((ref, index) => ref.order = index + 1);
    sequence.updatedAt = nowIso();
  }
  project.updatedAt = nowIso();
  if (saveProjects()) renderProjectDetail();
}
function moveShot(id, direction, refId = "") {
  const project = currentProject();
  if (currentSequenceId !== "master") {
    const sequence = currentSequence(project);
    if (!sequence) return;
    const refs = [...sequence.shotRefs].sort((a, b) => (a.order || 0) - (b.order || 0));
    const index = refs.findIndex((ref) => (refId && ref.id === refId) || ref.shotId === id);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= refs.length) return;
    [refs[index], refs[target]] = [refs[target], refs[index]];
    refs.forEach((ref, refIndex) => ref.order = refIndex + 1);
    sequence.shotRefs = refs;
    sequence.updatedAt = nowIso();
    project.updatedAt = nowIso();
    if (saveProjects()) renderProjectDetail();
    return;
  }

  const shots = sortedShots(project);
  const index = shots.findIndex((shot) => shot.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= shots.length) return;
  [shots[index].order, shots[target].order] = [shots[target].order, shots[index].order];
  project.storyboards = shots;
  if (saveProjects()) renderProjectDetail();
}
function bindDragEvents(card) {
  card.addEventListener("dragstart", () => {
    draggedShotId = card.dataset.shotId;
    draggedSequenceRefId = card.dataset.seqRefId || "";
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => {
    draggedShotId = null;
    draggedSequenceRefId = null;
    card.classList.remove("dragging");
  });
  card.addEventListener("dragover", (event) => event.preventDefault());
  card.addEventListener("drop", (event) => {
    event.preventDefault();
    const targetId = card.dataset.shotId;
    const targetRefId = card.dataset.seqRefId || "";
    if (!draggedShotId) return;
    if (currentSequenceId === "master" && draggedShotId === targetId) return;
    if (currentSequenceId !== "master" && draggedSequenceRefId && draggedSequenceRefId === targetRefId) return;
    reorderByDrag(draggedSequenceRefId || draggedShotId, targetRefId || targetId);
  });
}

function reorderByDrag(sourceId, targetId) {
  const project = currentProject();
  if (currentSequenceId !== "master") {
    const sequence = currentSequence(project);
    if (!sequence) return;
    const refs = [...sequence.shotRefs].sort((a, b) => (a.order || 0) - (b.order || 0));
    const sourceIndex = refs.findIndex((ref) => ref.id === sourceId || ref.shotId === sourceId);
    const targetIndex = refs.findIndex((ref) => ref.id === targetId || ref.shotId === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [source] = refs.splice(sourceIndex, 1);
    refs.splice(targetIndex, 0, source);
    refs.forEach((ref, index) => ref.order = index + 1);
    sequence.shotRefs = refs;
    sequence.updatedAt = nowIso();
    project.updatedAt = nowIso();
    if (saveProjects()) renderProjectDetail();
    return;
  }

  const shots = sortedShots(project);
  const sourceIndex = shots.findIndex((shot) => shot.id === sourceId);
  const targetIndex = shots.findIndex((shot) => shot.id === targetId);
  const [source] = shots.splice(sourceIndex, 1);
  shots.splice(targetIndex, 0, source);
  shots.forEach((shot, index) => shot.order = index + 1);
  project.storyboards = shots;
  if (saveProjects()) renderProjectDetail();
}
function renumberShots() {
  const project = currentProject();
  sortedShots(project).forEach((shot, index) => {
    shot.shotNumber = formatShotNumber(index + 1);
    shot.order = index + 1;
  });
  project.updatedAt = nowIso();
  if (saveProjects()) renderProjectDetail();
}

function formatShotNumber(number) {
  return String(number).padStart(3, "0");
}

function updateShotStatus(event) {
  const shot = currentProject().storyboards.find((item) => item.id === event.currentTarget.dataset.statusShot);
  shot.status = event.currentTarget.value;
  currentProject().updatedAt = nowIso();
  if (saveProjects()) renderProjectDetail();
}

async function handleReferenceUpload(event) {
  if (!imageDbAvailable) {
    alert("IndexedDB is not available. Reference images cannot be saved in this browser.");
    event.target.value = "";
    return;
  }
  const files = Array.from(event.target.files || []);
  for (const file of files) {
    try {
      if (file.size > 5 * 1024 * 1024) alert(`${file.name} is large. The app will compress it before saving to IndexedDB.`);
      const blob = await imageToBlob(file, 1600, .82);
      const imageId = uid("ref");
      const indexedDbKey = `image_${imageId}`;
      await saveImageBlob(indexedDbKey, blob);
      pendingReferenceImages.push({
        id: imageId,
        fileName: file.name,
        type: $("#shotForm [name='referenceType']").value,
        indexedDbKey,
        createdAt: nowIso()
      });
    } catch (error) {
      console.error("Image upload failed", error);
      alert(`Could not save ${file.name} to IndexedDB. Please try a smaller image or use Chrome.`);
    }
  }
  renderReferencePreview();
  event.target.value = "";
}

function imageToBlob(file, maxWidth, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Image compression failed."));
        }, "image/jpeg", quality);
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function saveImageBlob(key, blob) {
  return new Promise((resolve, reject) => {
    if (!imageDbAvailable || !imageDb) {
      reject(new Error("IndexedDB is not available."));
      return;
    }
    const transaction = imageDb.transaction(IMAGE_STORE_NAME, "readwrite");
    transaction.objectStore(IMAGE_STORE_NAME).put({ key, blob, updatedAt: nowIso() });
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error || new Error("Image save failed."));
  });
}

function getImageBlob(key) {
  return new Promise((resolve) => {
    if (!imageDbAvailable || !imageDb || !key) {
      resolve(null);
      return;
    }
    const transaction = imageDb.transaction(IMAGE_STORE_NAME, "readonly");
    const request = transaction.objectStore(IMAGE_STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result?.blob || null);
    request.onerror = () => resolve(null);
  });
}

function deleteImageBlob(key) {
  return new Promise((resolve) => {
    if (!imageDbAvailable || !imageDb || !key) {
      resolve(false);
      return;
    }
    const transaction = imageDb.transaction(IMAGE_STORE_NAME, "readwrite");
    transaction.objectStore(IMAGE_STORE_NAME).delete(key);
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => resolve(false);
    const objectUrl = imageObjectUrls.get(key);
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      imageObjectUrls.delete(key);
    }
  });
}

async function hydrateReferenceImages(root = document) {
  const images = Array.from(root.querySelectorAll("img[data-image-key]"));
  for (const img of images) {
    const key = img.dataset.imageKey;
    if (!key) continue;
    if (imageObjectUrls.has(key)) {
      img.src = imageObjectUrls.get(key);
      continue;
    }
    const blob = await getImageBlob(key);
    if (blob) {
      const objectUrl = URL.createObjectURL(blob);
      imageObjectUrls.set(key, objectUrl);
      img.src = objectUrl;
    } else {
      img.alt = `${img.alt || "Reference image"} missing from IndexedDB`;
      img.classList.add("missing-image");
    }
  }
  bindImagePreviewEvents(root);
}

function bindImagePreviewEvents(root = document) {
  root.querySelectorAll(`img[data-preview-image="true"]`).forEach((img) => {
    if (img.dataset.previewBound === "true") return;
    img.dataset.previewBound = "true";
    img.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openImagePreviewFromElement(img);
    });
    img.addEventListener("dragstart", (event) => event.preventDefault());
  });
}

function bindImagePreviewDialog() {
  const dialog = $("#imagePreviewDialog");
  if (!dialog || dialog.dataset.bound === "true") return;
  dialog.dataset.bound = "true";
  $("#closeImagePreviewBtn").addEventListener("click", closeImagePreview);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeImagePreview();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dialog.open) closeImagePreview();
  });
}

async function openImagePreviewFromElement(img) {
  const dialog = $("#imagePreviewDialog");
  const previewImg = $("#imagePreviewImg");
  const caption = $("#imagePreviewCaption");
  if (!dialog || !previewImg || !caption) return;
  let src = img.currentSrc || img.src || "";
  const key = img.dataset.imageKey;
  if (!src && key) {
    src = await getImageObjectUrl(key);
  }
  if (!src) {
    alert("This reference image could not be loaded from IndexedDB.");
    return;
  }
  previewImg.src = src;
  previewImg.alt = img.dataset.fileName || img.alt || "Reference image";
  caption.textContent = img.dataset.fileName || img.alt || "Reference image";
  dialog.showModal();
}

function closeImagePreview() {
  const dialog = $("#imagePreviewDialog");
  if (dialog?.open) dialog.close();
}

async function migrateLegacyReferenceImages() {
  if (!imageDbAvailable) return;
  let changed = false;
  for (const project of projects) {
    for (const shot of project.storyboards || []) {
      for (const image of shot.referenceImages || []) {
        if (image.dataUrl && !image.indexedDbKey) {
          const blob = dataUrlToBlob(image.dataUrl);
          const indexedDbKey = `image_${image.id || uid("legacy")}`;
          await saveImageBlob(indexedDbKey, blob);
          image.indexedDbKey = indexedDbKey;
          delete image.dataUrl;
          changed = true;
        }
      }
    }
  }
  if (changed) saveProjects("Migrated images");
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(header)?.[1] || "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

function renderReferencePreview() {
  $("#referencePreview").innerHTML = pendingReferenceImages.map((image) => `
    <div>
      <img ${image.dataUrl ? `src="${image.dataUrl}"` : `data-image-key="${escapeHTML(image.indexedDbKey)}"`} alt="${escapeHTML(image.fileName)}">
      <span class="hint">${escapeHTML(image.fileName)} · ${escapeHTML(image.type || "reference")}</span>
      <button class="danger" type="button" onclick="removePendingReference('${image.id}')">Remove Image</button>
    </div>`).join("");
  hydrateReferenceImages();
}

async function removePendingReference(id) {
  const image = pendingReferenceImages.find((item) => item.id === id);
  if (image?.indexedDbKey) await deleteImageBlob(image.indexedDbKey);
  pendingReferenceImages = pendingReferenceImages.filter((image) => image.id !== id);
  renderReferencePreview();
}

function fillPromptInForm() {
  const data = getFormValues($("#shotForm"));
  data.referenceImages = pendingReferenceImages;
  $("#shotForm [name='aiImagePrompt']").value = generateImagePrompt(data, currentProject());
}

function generateImagePrompt(shot, project) {
  const ratio = project?.aspectRatio || "16:9";
  const subject = shot.productOrBrandFocus || shot.description || shot.scene || "commercial brand moment";
  return `A cinematic storyboard frame of ${subject}, ${shot.shotSize || "medium"} shot, ${shot.cameraMovement || "static camera"}, ${shot.lightingMood || "natural motivated light"}, ${shot.shotPurpose || "commercial film planning"}, pencil sketch style, grayscale storyboard, clean composition, clear camera angle, clear subject position, not too polished, commercial film planning, ${ratio} frame.`;
}

function handleScriptGenerate(event) {
  event.preventDefault();
  const scriptText = $("#scriptInput").value.trim();
  if (!scriptText) return;
  const project = currentProject();
  const generated = generateStoryboardFromScript(scriptText);
  const start = project.storyboards.length;
  generated.forEach((shot, index) => {
    project.storyboards.push({
      ...createBlankShot(start + index + 1),
      ...shot,
      id: uid("shot"),
      shotNumber: formatShotNumber(start + index + 1),
      order: start + index + 1
    });
  });
  project.updatedAt = nowIso();
  if (saveProjects()) {
    event.currentTarget.closest("dialog").close();
    $("#scriptInput").value = "";
    renderProjectDetail();
  }
}

function generateStoryboardFromScript(scriptText) {
  return scriptText
    .split(/[。！？；;.!?\n]+|，|,/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, index) => {
      const lower = part.toLowerCase();
      const isHook = index === 0 || /开场|打开|进入|外观|门|阳光|first|open/.test(part);
      const product = /咖啡|产品|杯|豆|包装|food|coffee|product|drink/.test(lower);
      const human = /老板|客人|人物|采访|barista|customer|founder|owner/.test(lower);
      return {
        scene: inferScene(part),
        description: part,
        shotSize: product ? "Close-up" : isHook ? "Wide" : human ? "Medium" : "Detail Shot",
        lens: product ? "100mm Macro" : isHook ? "24mm" : "35mm",
        cameraMovement: /走|移动|拿起|打开|进入|push|move/.test(lower) ? "Push In" : "Static",
        shotPurpose: isHook ? "Hook" : product ? "Product Detail" : human ? "Human Story" : "B-roll",
        productOrBrandFocus: product ? "Product / brand detail" : "",
        status: "Not Shot",
        priority: isHook || product ? "Must Have" : "Good to Have",
        isHook,
        isMustHave: isHook || product,
        notes: "Generated from script rule-based demo."
      };
    });
}

function inferScene(text) {
  if (/外观|门|街|outside|exterior/i.test(text)) return "Exterior / Opening";
  if (/磨豆|冲煮|蒸汽|咖啡|杯|产品|product|coffee/i.test(text)) return "Product Process";
  if (/采访|说|老板|客人|人物|interview|owner|customer/i.test(text)) return "Human Moment";
  if (/结束|品牌|logo|ending|final/i.test(text)) return "Brand Ending";
  return "Scene";
}

function showCallSheet() {
  const text = generateCallSheet(currentProject());
  $("#callSheetOutput").textContent = text;
  $("#callSheetPanel").classList.remove("hidden");
  $("#optimizePanel").classList.add("hidden");
}

function generateCallSheet(project) {
  const shots = sortedShots(project);
  const must = shots.filter((s) => s.isMustHave || s.priority === "Must Have");
  const locations = unique(shots.map((s) => s.location).filter(Boolean));
  const props = unique(shots.flatMap((s) => splitList(s.props)));
  const art = unique(shots.flatMap((s) => splitList(`${s.background}, ${s.lightingMood}, ${s.wardrobeOrStyling}`)));
  const sound = unique(shots.flatMap((s) => splitList(`${s.soundNotes}, ${s.voiceOverNotes}, ${s.musicMood}`)));
  const order = optimizeShots(shots).map((s, i) => `${i + 1}. ${s.shotNumber} - ${s.scene} (${s.location || "location TBD"})`).join("\n");
  return `CALL SHEET

Project: ${project.title}
Client: ${project.clientName || "-"}
Brand: ${project.brandName || "-"}
Shoot Date: ${project.shootingDate || "-"}
Shoot Location: ${locations.join(", ") || "-"}
Shoot Time: ${unique(shots.map((s) => s.shootTime).filter(Boolean)).join(", ") || "-"}

Main Scenes:
${unique(shots.map((s) => s.scene).filter(Boolean)).map((s) => `- ${s}`).join("\n") || "- TBD"}

Must-Have Shots: ${must.length}

Props:
${props.map((item) => `- ${item}`).join("\n") || "- None listed"}

Art Direction Prep:
${art.map((item) => `- ${item}`).join("\n") || "- None listed"}

Sound Prep:
${sound.map((item) => `- ${item}`).join("\n") || "- None listed"}

Suggested Shooting Order:
${order || "- Add shots first"}

Risk Reminders:
- Confirm client-approved product, logo placement and hero items before shooting.
- Capture clean product details before props, food, drinks or light quality change.
- Record room tone and any live dialogue while the set is quiet.

Team Notes:
${project.notes || "- Add production notes here."}`;
}

function copyCallSheet() {
  const text = $("#callSheetOutput").textContent;
  const fallback = $("#manualCopyText");
  fallback.classList.add("hidden");
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => alert("Call sheet copied."))
      .catch(() => showManualCopyFallback(text));
  } else {
    showManualCopyFallback(text);
  }
}

function showManualCopyFallback(text) {
  const fallback = $("#manualCopyText");
  fallback.value = text;
  fallback.classList.remove("hidden");
  fallback.focus();
  fallback.select();
  alert("Clipboard copy is blocked in this browser. The call sheet text is selected below; press Ctrl+C to copy it manually.");
}

function showOptimizedOrder() {
  const shots = optimizeShots(sortedShots());
  $("#optimizeOutput").innerHTML = `
    <ol>${shots.map((shot) => `<li><b>${escapeHTML(shot.shotNumber)}</b> ${escapeHTML(shot.scene)} 路 ${escapeHTML(shot.location || "Location TBD")} 路 ${escapeHTML(shot.priority)} 路 ${escapeHTML(shot.status)}</li>`).join("")}</ol>
    <p class="hint">Rule: Must Have first, grouped by location and scene, already-shot items later, Optional near the end. Shots sharing the same location and scene can usually be filmed together. Optional and already-shot items are good candidates for final pickup time.</p>`;
  $("#optimizePanel").classList.remove("hidden");
  $("#callSheetPanel").classList.add("hidden");
}

function optimizeShots(shots) {
  const priorityWeight = { "Must Have": 0, "Good to Have": 1, "Optional": 3 };
  const statusWeight = { "Not Shot": 0, "Need Reshoot": 1, "Optional": 2, "Shot": 4, "Removed": 5 };
  return [...shots].sort((a, b) =>
    (priorityWeight[a.priority] ?? 2) - (priorityWeight[b.priority] ?? 2) ||
    String(a.location || "").localeCompare(String(b.location || "")) ||
    String(a.scene || "").localeCompare(String(b.scene || "")) ||
    (statusWeight[a.status] ?? 2) - (statusWeight[b.status] ?? 2) ||
    (a.order || 0) - (b.order || 0)
  );
}

async function exportPDF() {
  const project = currentProject();
  if (!project) {
    alert("Open a project before exporting PDF.");
    return;
  }

  setSaveStatus("Preparing PDF...", "unsaved");

  const styleHref = new URL("style.css", window.location.href).href;
  const versionKey = $("#pdfVersionSelect")?.value || "client";
  const version = PDF_VERSIONS[versionKey] || PDF_VERSIONS.client;
  const printMarkup = await buildPdfMarkup(project, version);
  const sequenceName = currentSequenceName(project);
  const title = safeFileName(`${project.title || "Fusion Storyboard OS"}-${sequenceName}-${version.title}`);
  const printWindow = window.open("", "_blank", "width=1100,height=800");

  if (!printWindow) {
    document.body.classList.add("printing-now");
    setSaveStatus("Opening print dialog...", "unsaved");
    window.focus();
    window.print();
    setTimeout(() => {
      document.body.classList.remove("printing-now");
      setSaveStatus("Print dialog opened", "saved");
    }, 500);
    return;
  }

  printWindow.document.open();
  printWindow.document.write(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHTML(title)} PDF Export</title>
  <link rel="stylesheet" href="${styleHref}">
</head>
<body class="print-export">
  <main class="print-window-main">${printMarkup}</main>
  <script>
    window.addEventListener("load", function () {
      setTimeout(function () {
        window.focus();
        window.print();
      }, 250);
    });
  <\/script>
</body>
</html>`);
  printWindow.document.close();

  setTimeout(() => setSaveStatus("Print dialog opened", "saved"), 500);
}

async function buildPdfMarkup(project, version) {
  const shots = filteredShots(project);
  const cards = [];
  for (const shot of shots) {
    const imageMarkup = await buildPdfImagesMarkup(shot.referenceImages || []);
    cards.push(`
      <article class="shot-card pdf-shot-card">
        <div class="shot-head">
          <div>
            <div class="shot-number">${escapeHTML(shot.shotNumber)}</div>
            <div class="shot-title">${escapeHTML(shot.scene || "Untitled scene")}</div>
          </div>
          <span class="tag ${statusClass(shot.status)}">${escapeHTML(shot.status)}</span>
        </div>
        ${imageMarkup}
        <p class="shot-description">${escapeHTML(shot.description || "No description.")}</p>
        <div class="shot-meta">
          ${version.fields.map(([label, accessor]) => `<span><b>${escapeHTML(label)}</b> ${escapeHTML(resolvePdfField(shot, accessor) || "-")}</span>`).join("")}
        </div>
      </article>`);
  }

  return `
    <section id="printArea">
      <div class="detail-head">
        <div>
          <p class="eyebrow">${escapeHTML(version.title)}</p>
          <h2>${escapeHTML(project.title)} - ${escapeHTML(currentSequenceName(project))}</h2>
          <p id="projectSubtitle">${escapeHTML(project.clientName || "No client")} / ${escapeHTML(project.brandName || "No brand")} / ${escapeHTML(project.projectType)} / ${escapeHTML(project.shootingDate || "No shooting date")} / ${escapeHTML(project.aspectRatio)}</p>
        </div>
      </div>
      <div class="shot-grid">${cards.join("") || `<div class="empty">No shots match the current filters.</div>`}</div>
    </section>`;
}

async function buildPdfImagesMarkup(images) {
  const pieces = [];
  for (const image of images) {
    let src = image.dataUrl || "";
    if (!src && image.indexedDbKey) {
      src = await getImageObjectUrl(image.indexedDbKey);
    }
    if (src) pieces.push(`<img class="reference-image" src="${src}" alt="${escapeHTML(image.fileName)}">`);
  }
  return pieces.length ? `<div class="reference-strip">${pieces.join("")}</div>` : "";
}

async function getImageObjectUrl(key) {
  if (imageObjectUrls.has(key)) return imageObjectUrls.get(key);
  const blob = await getImageBlob(key);
  if (!blob) return "";
  const objectUrl = URL.createObjectURL(blob);
  imageObjectUrls.set(key, objectUrl);
  return objectUrl;
}

function resolvePdfField(shot, accessor) {
  return typeof accessor === "function" ? accessor(shot) : shot[accessor];
}

function exportCSV() {
  const headers = ["Shot Number", "Scene", "Description", "Shot Size", "Lens", "Camera Movement", "Location", "Shoot Time", "Priority", "Status", "Shot Purpose", "Product / Brand Focus", "Props", "Sound Notes", "Post Production Notes", "Notes"];
  const rows = filteredShots().map((shot) => [
    shot.shotNumber, shot.scene, shot.description, shot.shotSize, shot.lens, shot.cameraMovement, shot.location, shot.shootTime, shot.priority, shot.status, shot.shotPurpose, shot.productOrBrandFocus, shot.props, shot.soundNotes, shot.postProductionNotes, shot.notes
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const sequenceSuffix = currentSequenceId === "master" ? "master" : safeFileName(currentSequenceName());
  downloadFile(`${safeFileName(currentProject().title)}-${sequenceSuffix}-shot-list.csv`, `\uFEFF${csv}`, "text/csv;charset=utf-8");
}

function csvCell(value) {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

function exportJSON() {
  downloadFile("fusion-storyboard-os-v4-2-local-backup.json", JSON.stringify({ version: "4.2", schemaVersion: SCHEMA_VERSION, exportedAt: nowIso(), imageStorage: "IndexedDB metadata only", projects: stripImageDataFromProjects(projects) }, null, 2), "application/json");
}

function openPackageExportDialog() {
  $("#exportCurrentPackageBtn").disabled = !currentProject();
  $("#packageExportDialog").showModal();
}

async function buildProjectPackageBlob(projectId, options = {}) {
  if (!imageDbAvailable) throw new Error("IndexedDB is not available, so reference images cannot be included.");
  const selectedProjects = options.allProjects
    ? projects
    : projects.filter((project) => project.id === projectId);
  if (!selectedProjects.length) throw new Error("No project is selected for this package.");

  const packageProjects = JSON.parse(JSON.stringify(stripImageDataFromProjects(selectedProjects)));
  const files = [];
  const embeddedPaths = new Map();
  let embeddedImageCount = 0;
  let missingImageCount = 0;

  for (const project of packageProjects) {
    for (const shot of project.storyboards || []) {
      for (const image of shot.referenceImages || []) {
        if (!image.indexedDbKey) {
          missingImageCount += 1;
          console.warn("Package image metadata has no IndexedDB key.", image);
          continue;
        }
        let packagePath = embeddedPaths.get(image.indexedDbKey);
        if (!packagePath) {
          const imageBlob = await getImageBlob(image.indexedDbKey);
          if (!imageBlob) {
            missingImageCount += 1;
            console.warn(`Reference image blob not found: ${image.indexedDbKey}`, image);
            continue;
          }
          const extension = imageExtension(imageBlob.type, image.fileName);
          packagePath = `images/${image.indexedDbKey}${extension}`;
          embeddedPaths.set(image.indexedDbKey, packagePath);
          files.push({ name: packagePath, data: new Uint8Array(await imageBlob.arrayBuffer()) });
          embeddedImageCount += 1;
          image.mimeType = imageBlob.type || "image/jpeg";
        }
        image.packagePath = packagePath;
        image.mimeType = image.mimeType || "image/jpeg";
      }
    }
  }

  const manifest = {
    packageVersion: "4.2",
    app: "Fusion Storyboard OS",
    appVersion: "4.2",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowIso(),
    packageScope: options.allProjects ? "all-projects-backup" : "single-project",
    imageStorage: "embedded in package zip",
    projects: packageProjects
  };
  files.unshift({ name: "fusion-storyboard-package.json", data: JSON.stringify(manifest, null, 2) });
  const packageBlob = createZipBlob(files);
  packageBlob.fusionStats = { projectCount: packageProjects.length, embeddedImageCount, missingImageCount };
  return packageBlob;
}

async function exportProjectPackage(scope = "current") {
  setSaveStatus("Local Building Package", "unsaved");
  try {
    const allProjects = scope === "all";
    const packageBlob = await buildProjectPackageBlob(currentProjectId, { allProjects });
    const filename = allProjects
      ? `fusion-storyboard-os-all-projects-${new Date().toISOString().slice(0, 10)}.zip`
      : `${safeFileName(currentProject().title)}.storyboard.zip`;
    downloadFile(filename, packageBlob, DRIVE_PACKAGE_MIME);
    setSaveStatus("Local Package Exported", "saved");
    $("#packageExportDialog").close();
    if (packageBlob.fusionStats?.missingImageCount) {
      alert(`Package exported with ${packageBlob.fusionStats.missingImageCount} missing image blob(s). Check the console and keep the original images as backup.`);
    }
  } catch (error) {
    console.error("Package export failed", error);
    setSaveStatus("Local Package Failed", "failed");
    alert(`Package export failed: ${error.message}`);
  }
}

async function restoreProjectPackageBlob(packageBlob, options = {}) {
  if (!imageDbAvailable) throw new Error("IndexedDB is not available. Images cannot be restored.");
  const entries = await readZipEntries(packageBlob);
  const manifestFile = entries.get("fusion-storyboard-package.json");
  if (!manifestFile) throw new Error("Package corrupted: fusion-storyboard-package.json is missing.");

  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestFile));
  } catch (error) {
    throw new Error(`Package corrupted: ${error.message}`);
  }
  const rawProjects = manifest.projects || [];
  if (!Array.isArray(rawProjects) || !rawProjects.length) throw new Error("Package corrupted: no projects were found.");

  let restoredImageCount = 0;
  let missingImageCount = 0;
  const restoredImageKeys = new Map();
  for (const project of rawProjects) {
    for (const shot of project.storyboards || []) {
      for (const image of shot.referenceImages || []) {
        if (!image.packagePath) {
          missingImageCount += 1;
          console.warn("Package image metadata is missing packagePath; metadata was retained.", image);
          continue;
        }
        const packagePath = normalizePackagePath(image.packagePath);
        if (!entries.has(packagePath)) {
          missingImageCount += 1;
          console.warn(`Package image file not found: ${packagePath}`, image);
          continue;
        }
        if (restoredImageKeys.has(packagePath)) {
          image.indexedDbKey = restoredImageKeys.get(packagePath);
          delete image.packagePath;
          delete image.mimeType;
          continue;
        }
        try {
          const imageBlob = new Blob([entries.get(packagePath)], { type: image.mimeType || "image/jpeg" });
          const newIndexedDbKey = `image_${uid("import")}`;
          await saveImageBlob(newIndexedDbKey, imageBlob);
          image.indexedDbKey = newIndexedDbKey;
          restoredImageKeys.set(packagePath, newIndexedDbKey);
          delete image.packagePath;
          delete image.mimeType;
          restoredImageCount += 1;
        } catch (imageError) {
          missingImageCount += 1;
          console.warn(`Could not restore package image: ${packagePath}`, imageError, image);
        }
      }
    }
  }

  const importedProjects = migrateProjects(rawProjects);
  if (options.mode === "upsert") {
    for (const importedProject of importedProjects) {
      const existingIndex = projects.findIndex((project) => project.id === importedProject.id);
      if (existingIndex >= 0) projects.splice(existingIndex, 1, importedProject);
      else projects.unshift(importedProject);
    }
  } else {
    projects = importedProjects;
  }

  const saved = saveProjects(options.saveLabel || "Package Imported", { suppressCloudPending: Boolean(options.suppressCloudPending) });
  if (!saved) throw new Error("The package was restored in memory, but localStorage could not save it. Export a package before closing the page.");
  return {
    manifest,
    projects: importedProjects,
    importedProjectCount: importedProjects.length,
    restoredImageCount,
    missingImageCount
  };
}

async function importProjectPackage(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const isZipFile = /\.(zip|fsb)$/i.test(file.name) || file.type === DRIVE_PACKAGE_MIME || file.type === "application/x-zip-compressed";
    if (!isZipFile) throw new Error("Import the original .zip or .fsb package, not its extracted manifest or images folder.");
    if (!confirm("Import project package and overwrite current local data?")) return;
    const result = await restoreProjectPackageBlob(file, { mode: "replace-all", saveLabel: "Package Imported" });
    currentProjectId = null;
    clearCurrentDriveFile();
    renderProjects();
    alert(`Package import complete.\n\nImported projects: ${result.importedProjectCount}\nRestored images: ${result.restoredImageCount}\nMissing images: ${result.missingImageCount}`);
  } catch (error) {
    console.error("Package import failed", error);
    alert(`Package import failed: ${error.message}`);
  } finally {
    event.target.value = "";
  }
}
function importJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const importedProjects = migrateProjects(Array.isArray(parsed) ? parsed : parsed.projects);
      if (!Array.isArray(importedProjects)) throw new Error("Invalid backup format.");
      if (confirm("Import JSON backup and overwrite current local data?")) {
        projects = importedProjects;
        currentProjectId = null;
        clearCurrentDriveFile(false);
        if (saveProjects("Imported", { suppressCloudPending: true })) renderProjects();
      }
    } catch (error) {
      alert(`Import failed: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file);
}

function getFusionConfig() {
  return window.FUSION_CONFIG || {};
}

function safeStorageGet(storage, key) {
  try {
    return storage.getItem(key) || "";
  } catch (error) {
    console.warn(`Could not read browser storage key: ${key}`, error);
    return "";
  }
}

function safeStorageSet(storage, key, value) {
  try {
    storage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`Could not write browser storage key: ${key}`, error);
    return false;
  }
}

function safeStorageRemove(storage, key) {
  try {
    storage.removeItem(key);
  } catch (error) {
    console.warn(`Could not remove browser storage key: ${key}`, error);
  }
}

function initializeDrivePreferences() {
  $("#driveAutoSaveToggle").checked = safeStorageGet(localStorage, DRIVE_AUTO_SAVE_KEY) === "true";
}

function restoreDriveSession() {
  const raw = safeStorageGet(sessionStorage, DRIVE_SESSION_KEY);
  if (!raw) return;
  try {
    currentDriveFile = JSON.parse(raw);
  } catch (error) {
    console.warn("Current Drive file session could not be restored.", error);
    currentDriveFile = null;
  }
}

function persistCurrentDriveFile() {
  if (!currentDriveFile) return clearCurrentDriveFile();
  safeStorageSet(sessionStorage, DRIVE_SESSION_KEY, JSON.stringify(currentDriveFile));
  safeStorageSet(localStorage, DRIVE_LAST_FILE_ID_KEY, currentDriveFile.fileId || "");
  safeStorageSet(localStorage, DRIVE_LAST_FILE_NAME_KEY, currentDriveFile.name || "");
}

function clearCurrentDriveFile(render = true) {
  currentDriveFile = null;
  driveChangesPending = false;
  safeStorageRemove(sessionStorage, DRIVE_SESSION_KEY);
  if (render) renderDriveControls();
}

function syncDriveFileForProject(project) {
  if (!project) return;
  const metadata = migrateCloudMetadata(project.cloudMetadata);
  project.cloudMetadata = metadata;
  if (metadata.fileId) {
    currentDriveFile = {
      projectId: project.id,
      fileId: metadata.fileId,
      name: metadata.fileName,
      modifiedTime: metadata.modifiedTime,
      folderId: metadata.folderId,
      lastLoadedRevision: metadata.modifiedTime
    };
    persistCurrentDriveFile();
  } else if (currentDriveFile?.projectId !== project.id) {
    clearCurrentDriveFile(false);
  }
  driveChangesPending = Boolean(metadata.fileId && metadata.lastCloudSaveAt && new Date(project.updatedAt).getTime() > new Date(metadata.lastCloudSaveAt).getTime());
  if (driveAccessToken) setDriveStatus(driveChangesPending ? "pending" : "connected", driveChangesPending ? "Drive Changes Pending" : "Drive Connected");
  renderDriveControls();
}

function renderDriveControls() {
  const connected = Boolean(driveAccessToken && Date.now() < driveTokenExpiresAt);
  $("#connectDriveBtn").classList.toggle("hidden", connected);
  $("#connectedDriveActions").classList.toggle("hidden", !connected);
  $("#saveDriveBtn").disabled = !connected || !currentDriveFile?.fileId || !currentProject();
  $("#saveAsDriveBtn").disabled = !connected || !currentProject();
  $("#openDriveBtn").disabled = !connected;
  const status = $("#driveStatus");
  status.textContent = connected ? driveStatusMessage : "Drive Disconnected";
  status.className = `save-status drive-status ${connected ? driveStatusState : "disconnected"}`;
  status.title = currentDriveFile?.name ? `Current Drive file: ${currentDriveFile.name}` : "No current Drive file";
}

function setDriveStatus(state, message) {
  driveStatusState = state;
  driveStatusMessage = message;
  renderDriveControls();
}

function markDriveChangesPending() {
  if (!currentProject() || currentDriveFile?.projectId !== currentProjectId || !currentDriveFile?.fileId) {
    if (driveAccessToken) setDriveStatus("connected", "Drive Connected");
    return;
  }
  driveChangesPending = true;
  currentProject().cloudMetadata = migrateCloudMetadata(currentProject().cloudMetadata);
  currentProject().cloudMetadata.cloudStatus = "pending";
  setDriveStatus("pending", "Drive Changes Pending");
  scheduleDriveAutoSave();
}

function updateDriveAutoSavePreference(event) {
  safeStorageSet(localStorage, DRIVE_AUTO_SAVE_KEY, event.currentTarget.checked ? "true" : "false");
  if (event.currentTarget.checked) scheduleDriveAutoSave();
  else if (driveAutoSaveTimer) clearTimeout(driveAutoSaveTimer);
}

function scheduleDriveAutoSave() {
  if (driveAutoSaveTimer) clearTimeout(driveAutoSaveTimer);
  if (!$("#driveAutoSaveToggle").checked || !driveChangesPending || !driveAccessToken || !currentDriveFile?.fileId) return;
  driveAutoSaveTimer = window.setTimeout(() => {
    driveAutoSaveTimer = null;
    if (driveChangesPending && !driveUploadInProgress) saveToDrive({ automatic: true });
  }, 30000);
}

async function waitForGoogleIdentity() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (window.google?.accounts?.oauth2) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Google Drive API unavailable. Check your internet connection and content-blocking settings.");
}

async function connectGoogleDrive() {
  try {
    if (location.protocol === "file:") {
      throw new Error("Google Drive cannot authorize from file://. Open the app through GitHub Pages HTTPS or http://localhost:8080.");
    }
    if (!navigator.onLine) throw new Error("Offline. Local projects remain available.");
    const config = getFusionConfig();
    if (!config.GOOGLE_CLIENT_ID || /YOUR_GOOGLE/.test(config.GOOGLE_CLIENT_ID)) {
      throw new Error("Google config missing: add GOOGLE_CLIENT_ID to config.js.");
    }
    await waitForGoogleIdentity();
    const token = await new Promise((resolve, reject) => {
      driveTokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: config.GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: (response) => {
          if (response?.error) reject(new Error(response.error_description || response.error));
          else resolve(response);
        },
        error_callback: (error) => reject(new Error(error?.message || "Authorization denied or browser popup blocked."))
      });
      driveTokenClient.requestAccessToken({ prompt: "consent" });
    });
    driveAccessToken = token.access_token;
    driveTokenExpiresAt = Date.now() + Math.max(60, Number(token.expires_in || 3600) - 60) * 1000;
    setDriveStatus("connected", "Drive Connected");
    if (!safeStorageGet(localStorage, DRIVE_FOLDER_KEY)) $("#driveFolderDialog").showModal();
  } catch (error) {
    console.error("Google Drive connection failed", error);
    setDriveStatus("failed", "Drive Connection Failed");
    alert(error.message);
  }
}

function disconnectGoogleDrive() {
  const token = driveAccessToken;
  driveAccessToken = "";
  driveTokenExpiresAt = 0;
  driveTokenClient = null;
  if (token && window.google?.accounts?.oauth2?.revoke) {
    window.google.accounts.oauth2.revoke(token, () => {});
  }
  setDriveStatus("disconnected", "Drive Disconnected");
}

function assertDriveConnected() {
  if (!navigator.onLine) throw new Error("Offline. Your local project is still saved in this browser.");
  if (!driveAccessToken || Date.now() >= driveTokenExpiresAt) {
    driveAccessToken = "";
    driveTokenExpiresAt = 0;
    setDriveStatus("disconnected", "Drive Disconnected");
    throw new Error("Access token expired. Connect Google Drive again.");
  }
}

async function authorizedDriveFetch(url, options = {}) {
  assertDriveConnected();
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${driveAccessToken}`);
  let response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (error) {
    throw new Error(`Google Drive network request failed: ${error.message}`);
  }
  if (response.ok) return response;
  let details = "";
  try {
    const payload = await response.json();
    details = payload?.error?.message || payload?.error_description || "";
  } catch (error) {
    details = await response.text().catch(() => "");
  }
  if (response.status === 401) {
    driveAccessToken = "";
    driveTokenExpiresAt = 0;
    renderDriveControls();
    throw new Error("Access token expired. Connect Google Drive again.");
  }
  if (response.status === 403 && /quota|storage/i.test(details)) throw new Error(`Drive quota exceeded. ${details}`);
  if (response.status === 403) throw new Error(`User does not have permission. ${details}`);
  if (response.status === 404) throw new Error(`Drive file or folder not found. ${details}`);
  throw new Error(details || `Google Drive request failed (${response.status}).`);
}

async function driveJson(url, options = {}) {
  const response = await authorizedDriveFetch(url, options);
  return response.status === 204 ? {} : response.json();
}

async function createDefaultDriveFolder() {
  const message = $("#driveFolderMessage");
  message.textContent = "Creating folder...";
  try {
    const folder = await driveJson("https://www.googleapis.com/drive/v3/files?fields=id,name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Fusion Storyboard OS", mimeType: "application/vnd.google-apps.folder" })
    });
    safeStorageSet(localStorage, DRIVE_FOLDER_KEY, folder.id);
    message.textContent = `Folder ready: ${folder.name}`;
    setDriveStatus("connected", "Drive Connected");
    setTimeout(() => $("#driveFolderDialog").close(), 350);
  } catch (error) {
    console.error("Drive folder creation failed", error);
    message.textContent = error.message;
    setDriveStatus("failed", "Drive Folder Failed");
  }
}

async function loadGooglePicker() {
  const config = getFusionConfig();
  if (!config.GOOGLE_API_KEY || !config.GOOGLE_APP_ID || /YOUR_GOOGLE/.test(`${config.GOOGLE_API_KEY}${config.GOOGLE_APP_ID}`)) {
    throw new Error("Google Picker is not configured. Add GOOGLE_API_KEY and GOOGLE_APP_ID to config.js.");
  }
  for (let attempt = 0; attempt < 30 && !window.gapi; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  if (!window.gapi) throw new Error("Google Picker API unavailable. Check your internet connection or content blocker.");
  await new Promise((resolve, reject) => {
    window.gapi.load("picker", { callback: resolve, onerror: () => reject(new Error("Google Picker API failed to load.")) });
  });
  return config;
}

async function openGooglePicker(kind) {
  assertDriveConnected();
  const config = await loadGooglePicker();
  return new Promise((resolve, reject) => {
    const isFolder = kind === "folder";
    const view = new window.google.picker.DocsView(isFolder ? window.google.picker.ViewId.FOLDERS : window.google.picker.ViewId.DOCS)
      .setIncludeFolders(isFolder)
      .setSelectFolderEnabled(isFolder);
    const builder = new window.google.picker.PickerBuilder()
      .setOAuthToken(driveAccessToken)
      .setDeveloperKey(config.GOOGLE_API_KEY)
      .setAppId(config.GOOGLE_APP_ID)
      .addView(view)
      .enableFeature(window.google.picker.Feature.SUPPORT_DRIVES)
      .setCallback((data) => {
        if (data.action === window.google.picker.Action.PICKED) resolve(data.docs[0]);
        if (data.action === window.google.picker.Action.CANCEL) resolve(null);
      });
    if (/^https?:$/.test(location.protocol)) builder.setOrigin(location.origin);
    try {
      builder.build().setVisible(true);
    } catch (error) {
      reject(new Error(`Browser blocked popup: ${error.message}`));
    }
  });
}

async function chooseExistingDriveFolder() {
  const message = $("#driveFolderMessage");
  try {
    let folderId = "";
    const config = getFusionConfig();
    if (config.GOOGLE_API_KEY && config.GOOGLE_APP_ID && !/YOUR_GOOGLE/.test(`${config.GOOGLE_API_KEY}${config.GOOGLE_APP_ID}`)) {
      const picked = await openGooglePicker("folder");
      if (!picked) return;
      folderId = picked.id;
    } else {
      folderId = prompt("Paste the Google Drive folder ID. For shared folders, Google Picker configuration is recommended.", safeStorageGet(localStorage, DRIVE_FOLDER_KEY)) || "";
      if (!folderId) return;
    }
    const folder = await driveJson(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType&supportsAllDrives=true`);
    if (folder.mimeType !== "application/vnd.google-apps.folder") throw new Error("The selected Drive item is not a folder.");
    safeStorageSet(localStorage, DRIVE_FOLDER_KEY, folder.id);
    message.textContent = `Folder selected: ${folder.name}`;
    setTimeout(() => $("#driveFolderDialog").close(), 350);
  } catch (error) {
    console.error("Drive folder selection failed", error);
    message.textContent = error.message;
  }
}

async function openDriveBrowser() {
  try {
    assertDriveConnected();
    $("#driveBrowserDialog").showModal();
    await refreshDriveFileList();
  } catch (error) {
    console.error("Open From Drive failed", error);
    alert(error.message);
  }
}

async function refreshDriveFileList() {
  const list = $("#driveFileList");
  const folderId = safeStorageGet(localStorage, DRIVE_FOLDER_KEY);
  if (!folderId) {
    $("#driveBrowserFolder").textContent = "No Drive folder selected.";
    list.innerHTML = `<div class="empty">Create or choose a Drive folder first.</div>`;
    if (!$("#driveFolderDialog").open) $("#driveFolderDialog").showModal();
    return;
  }
  list.innerHTML = `<div class="empty">Loading Drive projects...</div>`;
  try {
    const folder = await driveJson(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name&supportsAllDrives=true`);
    $("#driveBrowserFolder").textContent = `Folder: ${folder.name}`;
    const query = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const result = await driveJson(`https://www.googleapis.com/drive/v3/files?q=${query}&orderBy=modifiedTime%20desc&fields=files(id,name,mimeType,modifiedTime,size,parents)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`);
    const files = (result.files || []).filter((file) => /\.(zip|fsb)$/i.test(file.name) || /zip|octet-stream/.test(file.mimeType || ""));
    list.innerHTML = files.length ? files.map((file) => `
      <div class="drive-file-row">
        <div><strong>${escapeHTML(file.name)}</strong><span>${escapeHTML(formatDriveDate(file.modifiedTime))} · ${escapeHTML(formatFileSize(file.size))}</span></div>
        <button class="primary" type="button" data-open-drive-file="${escapeHTML(file.id)}">Open</button>
      </div>`).join("") : `<div class="empty">No Storyboard package files found in this folder.</div>`;
    list.querySelectorAll("[data-open-drive-file]").forEach((button) => button.addEventListener("click", () => openDriveFileById(button.dataset.openDriveFile)));
  } catch (error) {
    console.error("Drive file list failed", error);
    list.innerHTML = `<div class="empty">${escapeHTML(error.message)}</div>`;
  }
}

async function pickDriveProjectFile() {
  try {
    const picked = await openGooglePicker("file");
    if (!picked) return;
    await openDriveFileById(picked.id);
  } catch (error) {
    console.error("Google Picker file selection failed", error);
    alert(error.message);
  }
}

function formatDriveDate(value) {
  if (!value) return "Unknown modified time";
  return new Date(value).toLocaleString();
}

function formatFileSize(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "Unknown size";
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function requestUnsavedDriveDecision() {
  if (!driveChangesPending || !currentDriveFile?.fileId) return Promise.resolve("discard");
  return new Promise((resolve) => {
    unsavedDialogResolver = resolve;
    $("#cloudUnsavedDialog").showModal();
  });
}

function resolveUnsavedDialog(action) {
  $("#cloudUnsavedDialog").close();
  const resolve = unsavedDialogResolver;
  unsavedDialogResolver = null;
  if (resolve) resolve(action);
}

async function openDriveFileById(fileId, options = {}) {
  try {
    const decision = options.skipPendingPrompt ? "discard" : await requestUnsavedDriveDecision();
    if (decision === "cancel") return;
    if (decision === "save") {
      const saved = await saveToDrive();
      if (!saved) return;
    }
    if (decision === "export") await exportProjectPackage("current");

    setDriveStatus("saving", "Drive Loading");
    const metadata = await driveJson(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,modifiedTime,size,parents&supportsAllDrives=true`);
    const response = await authorizedDriveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`);
    const packageBlob = await response.blob();
    const result = await restoreProjectPackageBlob(packageBlob, { mode: "upsert", suppressCloudPending: true, saveLabel: "Drive Loaded" });
    const importedProject = result.projects[0];
    currentProjectId = importedProject.id;
    currentSequenceId = "master";
    const folderId = metadata.parents?.[0] || safeStorageGet(localStorage, DRIVE_FOLDER_KEY);
    importedProject.cloudMetadata = {
      provider: "google-drive",
      fileId: metadata.id,
      fileName: metadata.name,
      folderId,
      modifiedTime: metadata.modifiedTime,
      lastCloudSaveAt: nowIso(),
      cloudStatus: "saved"
    };
    currentDriveFile = {
      projectId: importedProject.id,
      fileId: metadata.id,
      name: metadata.name,
      modifiedTime: metadata.modifiedTime,
      folderId,
      lastLoadedRevision: metadata.modifiedTime
    };
    persistCurrentDriveFile();
    saveProjects("Drive Loaded", { suppressCloudPending: true });
    driveChangesPending = false;
    setDriveStatus("saved", "Drive Saved");
    if ($("#driveBrowserDialog").open) $("#driveBrowserDialog").close();
    renderProjectDetail();
    alert(`Drive project loaded.\n\nImported projects: ${result.importedProjectCount}\nRestored images: ${result.restoredImageCount}\nMissing images: ${result.missingImageCount}`);
    return true;
  } catch (error) {
    console.error("Drive download failed", error);
    setDriveStatus("failed", "Drive Load Failed");
    alert(`Download failed: ${error.message}`);
    return false;
  }
}

async function findDriveFilesByName(name, folderId) {
  const escapedName = String(name).replace(/'/g, "\\'");
  const query = encodeURIComponent(`name = '${escapedName}' and '${folderId}' in parents and trashed = false`);
  const result = await driveJson(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,modifiedTime,parents)&pageSize=10&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  return result.files || [];
}

async function saveAsNewDriveFile() {
  try {
    assertDriveConnected();
    const project = currentProject();
    if (!project) throw new Error("Open a project before saving to Drive.");
    const folderId = safeStorageGet(localStorage, DRIVE_FOLDER_KEY);
    if (!folderId) {
      $("#driveFolderDialog").showModal();
      throw new Error("Choose or create a Google Drive folder first.");
    }
    let fileName = prompt("Drive project file name", `${safeFileName(project.title)}.storyboard.zip`);
    if (!fileName) return false;
    if (!/\.(zip|fsb)$/i.test(fileName)) fileName += ".storyboard.zip";
    const sameNameFiles = await findDriveFilesByName(fileName, folderId);
    let overwriteFile = null;
    if (sameNameFiles.length) {
      if (!confirm(`A Drive file named "${fileName}" already exists. Overwrite that file?`)) return false;
      overwriteFile = sameNameFiles[0];
    }

    setDriveStatus("saving", "Drive Saving");
    const packageBlob = await buildProjectPackageBlob(project.id);
    const uploaded = await uploadDrivePackage(packageBlob, { name: fileName, parents: overwriteFile ? undefined : [folderId] }, overwriteFile?.id || "");
    applyDriveFileToProject(project, uploaded, folderId);
    driveChangesPending = false;
    saveProjects("Drive Metadata Saved", { suppressCloudPending: true });
    setDriveStatus("saved", "Drive Saved");
    return true;
  } catch (error) {
    console.error("Save As to Drive failed", error);
    setDriveStatus("failed", "Drive Save Failed");
    alert(`Upload failed: ${error.message}`);
    return false;
  }
}

function requestConflictDecision(remoteFile) {
  $("#cloudConflictDetails").textContent = `Cloud modified: ${formatDriveDate(remoteFile.modifiedTime)}. Opened version: ${formatDriveDate(currentDriveFile?.modifiedTime)}.`;
  return new Promise((resolve) => {
    conflictDialogResolver = resolve;
    $("#cloudConflictDialog").showModal();
  });
}

function resolveConflictDialog(action) {
  $("#cloudConflictDialog").close();
  const resolve = conflictDialogResolver;
  conflictDialogResolver = null;
  if (resolve) resolve(action);
}

async function saveToDrive(options = {}) {
  if (driveUploadInProgress) return false;
  try {
    assertDriveConnected();
    const project = currentProject();
    if (!project) throw new Error("Open a project before saving to Drive.");
    if (!currentDriveFile?.fileId || currentDriveFile.projectId !== project.id) {
      if (options.automatic) return false;
      alert("This project does not have a current Drive file. Use Save As New Drive File first.");
      return false;
    }
    driveUploadInProgress = true;
    setDriveStatus("saving", "Drive Saving");
    const remoteFile = await driveJson(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(currentDriveFile.fileId)}?fields=id,name,modifiedTime,parents&supportsAllDrives=true`);
    const hasConflict = !options.force && currentDriveFile.modifiedTime && remoteFile.modifiedTime !== currentDriveFile.modifiedTime;
    if (hasConflict) {
      driveUploadInProgress = false;
      setDriveStatus("conflict", "Drive Conflict");
      if (options.automatic) return false;
      const decision = await requestConflictDecision(remoteFile);
      if (decision === "download") return openDriveFileById(remoteFile.id, { skipPendingPrompt: true });
      if (decision === "save-as") return saveAsNewDriveFile();
      if (decision === "force") {
        if (!confirm("Force overwrite will replace the newer Drive file. Continue?")) return false;
        return saveToDrive({ force: true });
      }
      return false;
    }

    const packageBlob = await buildProjectPackageBlob(project.id);
    const uploaded = await uploadDrivePackage(packageBlob, { name: currentDriveFile.name || remoteFile.name }, currentDriveFile.fileId);
    applyDriveFileToProject(project, uploaded, currentDriveFile.folderId || remoteFile.parents?.[0] || "");
    driveChangesPending = false;
    saveProjects("Drive Metadata Saved", { suppressCloudPending: true });
    setDriveStatus("saved", "Drive Saved");
    return true;
  } catch (error) {
    console.error("Save to Drive failed", error);
    setDriveStatus("failed", "Drive Save Failed");
    if (!options.automatic) alert(`Upload failed: ${error.message}`);
    return false;
  } finally {
    driveUploadInProgress = false;
  }
}

function applyDriveFileToProject(project, file, folderId) {
  project.cloudMetadata = {
    provider: "google-drive",
    fileId: file.id,
    fileName: file.name,
    folderId: folderId || file.parents?.[0] || "",
    modifiedTime: file.modifiedTime,
    lastCloudSaveAt: nowIso(),
    cloudStatus: "saved"
  };
  currentDriveFile = {
    projectId: project.id,
    fileId: file.id,
    name: file.name,
    modifiedTime: file.modifiedTime,
    folderId: project.cloudMetadata.folderId,
    lastLoadedRevision: file.modifiedTime
  };
  persistCurrentDriveFile();
}

async function uploadDrivePackage(packageBlob, metadata, fileId = "") {
  if (packageBlob.size >= DRIVE_RESUMABLE_THRESHOLD) {
    return uploadDrivePackageResumable(packageBlob, metadata, fileId);
  }
  const boundary = `fusion_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const endpoint = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,name,modifiedTime,size,parents&supportsAllDrives=true`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,size,parents&supportsAllDrives=true";
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${DRIVE_PACKAGE_MIME}\r\n\r\n`,
    packageBlob,
    `\r\n--${boundary}--`
  ]);
  const response = await authorizedDriveFetch(endpoint, {
    method: fileId ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body
  });
  return response.json();
}

async function uploadDrivePackageResumable(packageBlob, metadata, fileId = "") {
  const endpoint = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=resumable&fields=id,name,modifiedTime,size,parents&supportsAllDrives=true`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,modifiedTime,size,parents&supportsAllDrives=true";
  const startResponse = await authorizedDriveFetch(endpoint, {
    method: fileId ? "PATCH" : "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": DRIVE_PACKAGE_MIME,
      "X-Upload-Content-Length": String(packageBlob.size)
    },
    body: JSON.stringify(metadata)
  });
  const uploadUrl = startResponse.headers.get("Location");
  if (!uploadUrl) throw new Error("Drive resumable upload did not return an upload URL.");
  const response = await authorizedDriveFetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": DRIVE_PACKAGE_MIME },
    body: packageBlob
  });
  return response.json();
}

function downloadFile(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function imageExtension(mimeType, fileName = "") {
  const existing = /\.[a-z0-9]+$/i.exec(fileName)?.[0];
  if (existing) return existing.toLowerCase();
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}

function createZipBlob(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const encoder = new TextEncoder();
  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const crc = crc32(data);
    const localHeader = zipLocalHeader(nameBytes, data.length, crc);
    chunks.push(localHeader, data);
    central.push(zipCentralHeader(nameBytes, data.length, crc, offset));
    offset += localHeader.length + data.length;
  }
  const centralOffset = offset;
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = zipEndRecord(files.length, centralSize, centralOffset);
  return new Blob([...chunks, ...central, end], { type: "application/zip" });
}

function zipLocalHeader(nameBytes, size, crc) {
  const bytes = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true);
  bytes.set(nameBytes, 30);
  return bytes;
}

function zipCentralHeader(nameBytes, size, crc, offset) {
  const bytes = new Uint8Array(46 + nameBytes.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint16(14, 0, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, nameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offset, true);
  bytes.set(nameBytes, 46);
  return bytes;
}

function zipEndRecord(fileCount, centralSize, centralOffset) {
  const bytes = new Uint8Array(22);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, fileCount, true);
  view.setUint16(10, fileCount, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  return bytes;
}

async function readZipEntries(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const decoder = new TextDecoder();
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    if (method !== 0) throw new Error("This package uses compressed ZIP entries. Please import a package exported by Fusion Storyboard OS V3.");
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    entries.set(normalizePackagePath(name), bytes.slice(dataStart, dataStart + compressedSize));
    offset = dataStart + compressedSize;
  }
  return entries;
}

function normalizePackagePath(path) {
  return String(path || "").replace(/\\\\/g, "/").replace(/^\.\//, "");
}

function crc32(data) {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function setFormValues(form, data) {
  Object.entries(data).forEach(([key, value]) => {
    const field = form.elements[key];
    if (!field) return;
    if (field instanceof RadioNodeList) return;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else if (field.multiple) Array.from(field.options).forEach((option) => option.selected = (value || []).includes(option.value));
    else field.value = value ?? "";
  });
}

function getFormValues(form) {
  const data = {};
  Array.from(form.elements).forEach((field) => {
    if (!field.name) return;
    if (field.type === "checkbox") data[field.name] = field.checked;
    else if (field.multiple) data[field.name] = Array.from(field.selectedOptions).map((option) => option.value);
    else data[field.name] = field.value.trim();
  });
  return data;
}

function escapeHTML(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
}

function safeFileName(value) {
  return String(value || "project").replace(/[^\w\u4e00-\u9fa5-]+/g, "-").slice(0, 80);
}

function splitList(value) {
  return String(value || "").split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function createDemoProject() {
  const timestamp = nowIso();
  const titles = [
    ["Cafe Exterior Opening", "Morning light reveals the cafe storefront, sign and street context for the first brand impression.", "Wide", "24mm", "Push In", "Establishing", "Storefront", "Store sign, morning street", "Must Have"],
    ["Owner Opens The Door", "The owner opens the cafe door as warm interior light meets the morning street.", "Medium", "35mm", "Handheld", "Hook", "Entrance", "Keys, front door", "Must Have"],
    ["Grinding Coffee Beans", "Coffee beans drop into the grinder, with close attention to hand movement and texture.", "Close-up", "100mm Macro", "Static", "Process", "Bar counter", "Coffee beans, grinder", "Must Have"],
    ["Pour Over Brewing", "Hot water pours slowly into the dripper, creating a calm and precise brewing rhythm.", "Close-up", "85mm", "Slow Motion", "Product Beauty", "Brew bar", "Dripper, kettle", "Must Have"],
    ["Steam Detail", "Steam rises from the coffee surface to emphasize warmth, aroma and freshness.", "Extreme Close-up", "100mm Macro", "Macro Movement", "Product Detail", "Table", "Coffee cup, steam", "Good to Have"],
    ["Customer Picks Up Coffee", "A customer lifts the coffee from the table, revealing the cafe atmosphere around the product.", "Medium", "50mm", "Slide", "Human Story", "Window seat", "Coffee cup, table", "Good to Have"],
    ["Owner Interview", "The owner speaks beside the bar about the brand idea, with cafe tools visible in the background.", "Medium", "50mm", "Static", "Interview", "Bar counter", "Chair, microphone", "Must Have"],
    ["Brand Closing Shot", "The branded cup and storefront sign share the frame, leaving space for logo and end titles.", "Detail Shot", "85mm", "Push In", "Ending", "Counter", "Brand cup, logo", "Must Have"]
  ];
  return {
    schemaVersion: SCHEMA_VERSION,
    id: uid("project"),
    title: "Risen Coffee Brand Film",
    clientName: "Risen Coffee",
    brandName: "Risen Coffee",
    projectType: "Food / Cafe Video",
    shootingDate: "",
    platforms: ["Instagram Reels", "YouTube Shorts", "YouTube", "Xiaohongshu", "Website", "Ads", "Client Proposal", "Internal Planning"],
    aspectRatio: "16:9",
    status: "Planning",
    notes: "Demo project for a warm, commercial coffee brand film.",
    createdAt: timestamp,
    updatedAt: timestamp,
    storyboards: titles.map((item, index) => {
      const [scene, description, shotSize, lens, cameraMovement, shotPurpose, location, props, priority] = item;
      return {
        id: uid("shot"),
        shotNumber: formatShotNumber(index + 1),
        scene,
        description,
        shotSize,
        lens,
        cameraMovement,
        estimatedDuration: "3s",
        location,
        shootTime: "Morning",
        status: index < 2 ? "Shot" : "Not Shot",
        priority,
        shotPurpose,
        productOrBrandFocus: "Coffee, craft process and brand warmth",
        platforms: ["Instagram Reels", "YouTube Shorts", "YouTube", "Xiaohongshu", "Website", "Ads", "Client Proposal", "Internal Planning"],
        isHook: index === 0 || index === 1,
        isMustHave: priority === "Must Have",
        isReplaceable: priority !== "Must Have",
        soundNotes: "Cafe ambience and room tone",
        voiceOverNotes: index === 6 ? "Owner interview audio" : "",
        musicMood: "Warm, minimal, premium",
        needsAudioRecording: index === 6,
        props,
        background: "Clean cafe interior with warm morning light",
        lightingMood: "Warm morning window light",
        wardrobeOrStyling: "Simple neutral wardrobe",
        needsArtDirection: true,
        postProductionNotes: "Keep color warm, premium and natural.",
        captionIdea: "A morning ritual built with care.",
        aiImagePrompt: "",
        referenceImages: [],
        notes: "Demo shot. Adjust for actual location and client brief.",
        order: index + 1
      };
    })
  };
}

window.generateStoryboardFromScript = generateStoryboardFromScript;
window.removePendingReference = removePendingReference;







