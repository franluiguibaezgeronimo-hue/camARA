const DATABASE_NAME = "retrolens-gallery";
const DATABASE_VERSION = 1;
const PHOTO_STORE = "photos";
const FILTERS = {
  original: { label: "Original", css: "none" },
  vintage: { label: "Vintage", css: "sepia(0.65) contrast(1.08) saturate(0.82)" },
  mono: { label: "Blanco y negro", css: "grayscale(1) contrast(1.12)" },
  rose: { label: "Rosa suave", css: "sepia(0.2) saturate(1.3) hue-rotate(320deg)" },
  cool: { label: "Tono frío", css: "saturate(1.15) hue-rotate(12deg) contrast(1.04)" },
  pop: { label: "Color intenso", css: "saturate(1.8) contrast(1.12)" },
};

const video = document.querySelector("#video");
const cameraPlaceholder = document.querySelector("#cameraPlaceholder");
const filterSelect = document.querySelector("#filterSelect");
const startButton = document.querySelector("#startButton");
const statusMessage = document.querySelector("#status");
const gallery = document.querySelector("#gallery");
const photoCount = document.querySelector("#photoCount");
const emptyGallery = document.querySelector("#emptyGallery");
const captureCanvas = document.createElement("canvas");
const captureContext = captureCanvas.getContext("2d");

let cameraStarted = false;
let cameraStream = null;
let savedPhotoCount = 0;

function setStatus(message) {
  statusMessage.textContent = message;
}

function selectedFilter() {
  const filter = FILTERS[filterSelect.value];
  if (!filter) {
    throw new Error("El filtro seleccionado no es válido.");
  }
  return filter;
}

function updateFilterPreview() {
  video.style.filter = selectedFilter().css;
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PHOTO_STORE)) {
        database.createObjectStore(PHOTO_STORE, { keyPath: "id", autoIncrement: true });
      }
    };

    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir la galería."));
  });
}

function loadPhotos(database) {
  return new Promise((resolve, reject) => {
    const request = database.transaction(PHOTO_STORE, "readonly")
      .objectStore(PHOTO_STORE)
      .getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No se pudieron cargar las fotos."));
  });
}

function savePhoto(database, photo) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(PHOTO_STORE, "readwrite");
    const request = transaction.objectStore(PHOTO_STORE).add(photo);
    let photoId;

    request.onsuccess = () => {
      photoId = request.result;
    };
    transaction.oncomplete = () => resolve(photoId);
    transaction.onabort = () => {
      reject(transaction.error ?? new Error("No se pudo guardar la foto."));
    };
  });
}

function updatePhotoCount() {
  photoCount.textContent = `${savedPhotoCount} ${savedPhotoCount === 1 ? "foto guardada" : "fotos guardadas"}`;
}

function addPhotoToGallery(photo, newestFirst = false) {
  const card = document.createElement("article");
  card.className = "photo-card";

  const image = document.createElement("img");
  image.src = URL.createObjectURL(photo.image);
  image.alt = `Foto con filtro ${photo.filter}`;

  const details = document.createElement("div");
  details.className = "photo-details";

  const filterName = document.createElement("p");
  filterName.className = "photo-filter";
  filterName.textContent = photo.filter;

  const date = document.createElement("p");
  date.className = "photo-date";
  date.textContent = new Date(photo.createdAt).toLocaleString("es-ES");

  details.append(filterName, date);
  card.append(image, details);

  emptyGallery.remove();
  if (newestFirst) {
    gallery.prepend(card);
  } else {
    gallery.append(card);
  }

  savedPhotoCount += 1;
  updatePhotoCount();
}

async function initializeGallery() {
  try {
    const database = await databasePromise;
    const photos = await loadPhotos(database);
    for (const photo of photos.reverse()) {
      addPhotoToGallery(photo);
    }
    setStatus(photos.length ? "Tus fotos guardadas están listas." : "Elige un filtro y pulsa Iniciar para empezar.");
  } catch (error) {
    console.error("No se pudo cargar la galería.", error);
    setStatus("No se pudo acceder al almacenamiento de fotos de este navegador.");
  }
}

async function startCamera() {
  startButton.disabled = true;
  setStatus("Solicitando permiso para usar la cámara...");

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("La cámara requiere un navegador compatible y una conexión segura (HTTPS o localhost).");
    }

    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user" },
    });
    video.srcObject = cameraStream;
    await video.play();

    cameraStarted = true;
    cameraPlaceholder.hidden = true;
    startButton.textContent = "Tomar foto";
    setStatus("Cámara lista. Tu foto se guardará automáticamente en Mis fotos.");
  } catch (error) {
    cameraStream?.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    const message = error.name === "NotAllowedError" || error.name === "PermissionDeniedError"
      ? "No se permitió el acceso a la cámara. Revisa los permisos del navegador."
      : `No se pudo iniciar la cámara: ${error.message}`;
    console.error("No se pudo iniciar la cámara.", error);
    setStatus(message);
  } finally {
    startButton.disabled = false;
  }
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("No se pudo crear el archivo de la foto."));
      }
    }, "image/jpeg", 0.92);
  });
}

async function capturePhoto() {
  if (!video.videoWidth || !video.videoHeight || !captureContext) {
    setStatus("La cámara todavía no está lista. Espera un momento e inténtalo de nuevo.");
    return;
  }

  startButton.disabled = true;
  startButton.textContent = "Guardando...";

  try {
    const filter = selectedFilter();
    captureCanvas.width = video.videoWidth;
    captureCanvas.height = video.videoHeight;
    captureContext.save();
    captureContext.translate(captureCanvas.width, 0);
    captureContext.scale(-1, 1);
    captureContext.filter = filter.css;
    captureContext.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
    captureContext.restore();

    const image = await canvasToBlob(captureCanvas);
    const database = await databasePromise;
    const photo = {
      image,
      filter: filter.label,
      createdAt: new Date().toISOString(),
    };
    photo.id = await savePhoto(database, photo);
    addPhotoToGallery(photo, true);
    setStatus("¡Foto guardada! Ya está en Mis fotos y no se puede borrar desde esta página.");
  } catch (error) {
    console.error("No se pudo guardar la foto.", error);
    setStatus(`No se pudo guardar la foto: ${error.message}`);
  } finally {
    startButton.disabled = false;
    startButton.textContent = "Tomar foto";
  }
}

startButton.addEventListener("click", () => {
  if (cameraStarted) {
    capturePhoto();
  } else {
    startCamera();
  }
});

filterSelect.addEventListener("change", updateFilterPreview);
updateFilterPreview();

const databasePromise = openDatabase();
initializeGallery();

window.addEventListener("pagehide", () => {
  cameraStream?.getTracks().forEach((track) => track.stop());
});
