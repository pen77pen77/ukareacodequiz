import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  useMap,
} from "react-leaflet";
import Papa from "papaparse";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import noaLogo from "./NOA_circle.png";

// --- HELPER: REGION CALCULATOR ---
const getRegion = (code, lat, lng) => {
  // 1. Northern Ireland
  if (code.startsWith("028")) return "NI";

  // 2. Crown Dependencies (Not UK, but use +44 system)
  const crownCodes = ["01624", "01534", "01481"];
  if (crownCodes.includes(code)) return "Crown";

  // 3. Wales (Explicit List of main prefixes + User Corrections)
  const walesCodes = [
    "01239",
    "01248",
    "01267",
    "01269",
    "01286",
    "01291",
    "01341",
    "01348",
    "01352",
    "01407",
    "01437",
    "01443",
    "01446",
    "01492",
    "01495",
    "01550",
    "01554",
    "01558",
    "01597",
    "01600",
    "01633",
    "01639",
    "01646",
    "01654",
    "01656",
    "01685",
    "01686",
    "01745",
    "01758",
    "01766",
    "01792",
    "01834",
    "01873",
    "01874",
    "01938",
    "01970",
    "01974",
    "01978",
    "01982",
    "029",
    // Added Manual Corrections:
    "01994",
    "01559",
    "01570",
    "01545",
    "01591",
    "01650",
    "01678",
    "01690",
    "01490",
    "01824",
    "01497",
    "01547",
  ];
  if (walesCodes.includes(code)) return "Wales";

  // 4. Scotland (Geography + Border Overrides + User Corrections)
  if (lat >= 55.8) return "Scotland";

  const scotlandBorders = [
    "01387",
    "01450",
    "01573",
    "01835",
    "01576",
    "01461",
    "01556",
    "01557",
    "01671",
    "01776",
    "01988",
    "01890",
    "01361",
    "01721",
    "01896",
    "01750",
    "013873",
    "018907",
    // Added Manual Corrections:
    "01683",
    "01578",
  ];
  if (scotlandBorders.includes(code)) return "Scotland";

  // Specific English border codes that peak north
  const englandBorders = [
    "01289",
    "01668",
    "01665",
    "01670",
    "01434",
    "01228",
    "01697",
    "016977",
    "016973",
    "016974",
    "01946",
    "019467",
    "01900",
    "01768",
    "017683",
    "017684",
    "017687",
  ];
  if (englandBorders.includes(code)) return "England";

  if (lat >= 54.9 && lng < -3.5) return "Scotland";

  // 5. Default everything else to England (Includes Isles of Scilly)
  return "England";
};
// --- HELPER: SPELLCHECK (Typo Tolerance) ---
const getTypos = (a, b) => {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
        );
      }
    }
  }
  return matrix[b.length][a.length];
};
// 1. Map Zoom Component
function MapFocus({ location, animate, appSection }) {
  const map = useMap();
  useEffect(() => {
    if (location && animate) {
      // If Dictionary: Zoom in close (10). If Game: Keep the user's current zoom level!
      const targetZoom = appSection === "DICTIONARY" ? 10 : map.getZoom();
      map.flyTo([location.latitude, location.longitude], targetZoom, {
        animate: true,
        duration: 1.5,
      });
    }
  }, [location, animate, map, appSection]);
  return null;
}
// 2. Map Zoom Tracker (Listens for zoom changes to resize dots)
function ZoomTracker({ onZoom }) {
  const map = useMap();
  useEffect(() => {
    const handleZoom = () => onZoom(map.getZoom());
    map.on("zoomend", handleZoom);
    return () => map.off("zoomend", handleZoom);
  }, [map, onZoom]);
  return null;
}
export default function App() {
  const [areaCodes, setAreaCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mapZoom, setMapZoom] = useState(6); // NEW: Tracks zoom level for dot size
  // --- APP NAVIGATION ---
  const [appSection, setAppSection] = useState("GAME");
  const [regionFilter, setRegionFilter] = useState("All"); // NEW: Region State
  const [showInfo, setShowInfo] = useState(false); // NEW: Info Rules toggle
  // --- GAME STATE ---
  const [mode, setMode] = useState(
    () => localStorage.getItem("uk_codes_mode") || "nameToCode"
  );
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [userInput, setUserInput] = useState("");
  const [feedback, setFeedback] = useState("");
  const [autoNext, setAutoNext] = useState(() =>
    JSON.parse(localStorage.getItem("uk_codes_auto_next") || "true")
  );
  const [shouldZoom, setShouldZoom] = useState(false);
  const [showAllDots, setShowAllDots] = useState(() =>
    JSON.parse(localStorage.getItem("uk_codes_show_dots") || "true")
  );

  // --- REFS ---
  const inputRef = useRef(null);
  const markerRefs = useRef({});
  const dictItemRefs = useRef({});

  // --- DICTIONARY STATE ---
  const [searchTerm, setSearchTerm] = useState("");
  const [highlightCode, setHighlightCode] = useState(null);
  const [flashCode, setFlashCode] = useState(null);

  const [dictStatus, setDictStatus] = useState(() => {
    const saved = localStorage.getItem("uk_codes_dict_status");
    return saved ? JSON.parse(saved) : {};
  });

  // --- SAVE SYSTEM ---
  const [correctList, setCorrectList] = useState(() => {
    const saved = localStorage.getItem("uk_codes_mastered");
    return saved ? JSON.parse(saved) : [];
  });

  const [reviewList, setReviewList] = useState(() => {
    const saved = localStorage.getItem("uk_codes_review");
    return saved ? JSON.parse(saved) : [];
  });

  const [mistakeCount, setMistakeCount] = useState(() => {
    const saved = localStorage.getItem("uk_codes_mistakes");
    return saved ? parseInt(saved, 10) : 0;
  });

  useEffect(() => {
    localStorage.setItem("uk_codes_mastered", JSON.stringify(correctList));
  }, [correctList]);
  useEffect(() => {
    localStorage.setItem("uk_codes_review", JSON.stringify(reviewList));
  }, [reviewList]);
  useEffect(() => {
    localStorage.setItem("uk_codes_mistakes", mistakeCount.toString());
  }, [mistakeCount]);
  useEffect(() => {
    localStorage.setItem("uk_codes_dict_status", JSON.stringify(dictStatus));
  }, [dictStatus]);
  useEffect(() => {
    localStorage.setItem("uk_codes_mode", mode);
  }, [mode]);
  useEffect(() => {
    localStorage.setItem("uk_codes_auto_next", JSON.stringify(autoNext));
  }, [autoNext]);
  useEffect(() => {
    localStorage.setItem("uk_codes_show_dots", JSON.stringify(showAllDots));
  }, [showAllDots]);

  // Load CSV
  useEffect(() => {
    Papa.parse("/uk_codes.csv", {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const cleanData = results.data
          .filter((row) => row["Phone Code"] && row.Latitude && row.Longitude)
          .map((row) => {
            let rawPhoneCode = row["Phone Code"];
            if (!rawPhoneCode.startsWith("0"))
              rawPhoneCode = "0" + rawPhoneCode;

            const lat = parseFloat(row.Latitude);
            const lng = parseFloat(row.Longitude);

            return {
              code: rawPhoneCode, // Show the exact string: "028 90, 028 95..."

              // Keep the Place logic exactly as it was!
              place: row["Area"].replace(/\s*\[.*?\]/g, ""),
              rawPlace: row["Area"],
              latitude: lat,
              longitude: lng,
              region: getRegion(rawPhoneCode, lat, lng),
            };
          });

        const uniqueCodes = [];
        const seen = new Set();
        cleanData.forEach((item) => {
          if (!seen.has(item.code)) {
            uniqueCodes.push(item);
            seen.add(item.code);
          }
        });

        uniqueCodes.sort((a, b) => a.place.localeCompare(b.place));
        setAreaCodes(uniqueCodes);
        setLoading(false);
      },
    });
  }, []);

  // --- GAME LOGIC ---
  const generateQuestion = (specificPlace = null) => {
    setFeedback("");
    setUserInput("");

    setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
    }, 50);

    if (specificPlace) {
      setCurrentQuestion(specificPlace);
      setShouldZoom(false);
      return;
    }

    // Filter by BOTH un-mastered AND current region
    const pending = areaCodes.filter((item) => {
      const notMastered = !correctList.includes(item.code);
      const matchesRegion =
        regionFilter === "All" || item.region === regionFilter;
      return notMastered && matchesRegion;
    });

    if (pending.length === 0) {
      setFeedback(`🎉 You have mastered EVERY code in ${regionFilter}!`);
      setCurrentQuestion(null);
      return;
    }

    const nextQ = pending[Math.floor(Math.random() * pending.length)];
    setCurrentQuestion(nextQ);
    setShouldZoom(true);
  };

  // Generate new question if Data loads OR Region Filter changes
  useEffect(() => {
    if (appSection === "GAME" && !loading && areaCodes.length > 0) {
      generateQuestion();
    }
  }, [loading, areaCodes, appSection, regionFilter]);

  const addToReviewList = (code) => {
    if (!reviewList.includes(code)) setReviewList([...reviewList, code]);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!currentQuestion) return;

    let isCorrect = false;
    let inputClean = userInput.replace(/\s+/g, "").toLowerCase();

    if (mode === "nameToCode") {
      if (!inputClean.startsWith("0")) inputClean = "0" + inputClean;

      // Split the visible code string by commas or slashes
      let validCodes = currentQuestion.code.split(/[,/]/);

      for (let vCode of validCodes) {
        if (!vCode) continue;

        let answerClean = vCode.replace(/\s+/g, ""); // Remove spaces (e.g., "02890")

        // If the user types ANY of the valid codes, they win!
        if (inputClean === answerClean) {
          isCorrect = true;
          break;
        }
      }
    } else {
      // 1. Clean the user's input
      let userClean = inputClean.replace(/[^a-zA-Z]/g, "");

      // 2. Split the string by commas, slashes, AND square brackets []
      let validTowns = currentQuestion.rawPlace.split(/[,/\[\]]/);

      for (let town of validTowns) {
        if (!town) continue;

        // 3. Temporarily erase (Aberdeen) or (Gwynedd) so the player doesn't have to type it!
        let townWithoutParentheses = town.replace(/\(.*?\)/g, "");

        let answerClean = townWithoutParentheses
          .replace(/[^a-zA-Z]/g, "")
          .toLowerCase();
        if (answerClean.length === 0) continue;

        // Check exact match
        if (userClean === answerClean) {
          isCorrect = true;
          break;
        } else {
          // Check for typos
          let typoCount = getTypos(userClean, answerClean);
          let allowedTypos = answerClean.length > 6 ? 2 : 1;

          if (typoCount <= allowedTypos) {
            isCorrect = true;
            break;
          }
        }
      }
    }

    if (isCorrect) {
      setFeedback("✅ Correct!");
      if (!correctList.includes(currentQuestion.code)) {
        setCorrectList([...correctList, currentQuestion.code]);
      }
      if (autoNext) setTimeout(() => generateQuestion(), 1000);
      else setFeedback("✅ Correct! Select next location on map.");
    } else {
      setFeedback("❌ Incorrect. Try again!");
      setMistakeCount((prev) => prev + 1);
      addToReviewList(currentQuestion.code);
      if (inputRef.current) inputRef.current.focus();
    }
  };

  const revealAnswer = () => {
    setMistakeCount((prev) => prev + 1);
    addToReviewList(currentQuestion.code);
    setFeedback(
      `The answer is: ${
        mode === "nameToCode" ? currentQuestion.code : currentQuestion.place
      }`
    );
  };

  const resetProgress = () => {
    if (
      window.confirm(
        "Are you sure? This will wipe GAME progress (Green dots). Dictionary status will be kept."
      )
    ) {
      setCorrectList([]);
      setReviewList([]);
      setMistakeCount(0);
      localStorage.removeItem("uk_codes_mastered");
      localStorage.removeItem("uk_codes_review");
      localStorage.removeItem("uk_codes_mistakes");
      generateQuestion();
    }
  };

  const exportData = () => {
    const data = {
      m: correctList,
      r: reviewList,
      mi: mistakeCount,
      d: dictStatus,
    };
    const code = btoa(JSON.stringify(data));
    navigator.clipboard
      .writeText(code)
      .then(() => alert("✅ Save Code copied!"))
      .catch(() => prompt("Copy this code:", code));
  };

  const importData = () => {
    const code = prompt("Paste your Save Code here:");
    if (!code) return;
    try {
      const data = JSON.parse(atob(code));
      if (data.m) {
        localStorage.setItem("uk_codes_mastered", JSON.stringify(data.m));
        localStorage.setItem("uk_codes_review", JSON.stringify(data.r));
        localStorage.setItem("uk_codes_mistakes", data.mi);
        localStorage.setItem("uk_codes_dict_status", JSON.stringify(data.d));
        alert("✅ Import Successful! Reloading...");
        window.location.reload();
      } else alert("❌ Invalid Code format.");
    } catch (e) {
      alert("❌ Invalid Code. Please copy exactly.");
    }
  };

  const cycleStatus = (e, code) => {
    e.stopPropagation();
    const currentStatus = dictStatus[code] || 0;
    const nextStatus = (currentStatus + 1) % 3;
    setDictStatus((prev) => ({ ...prev, [code]: nextStatus }));
  };

  const jumpToLocation = (location) => {
    // 1. Update state to trigger the cinematic flight
    setCurrentQuestion(location);
    setShouldZoom(true);

    // 2. Add a microscopic 50ms delay to open the text bubble.
    // This gives the map just enough time to start moving first so the
    // animation is buttery smooth, but it feels instant to the user.
    setTimeout(() => {
      const marker = markerRefs.current[location.code];
      if (marker) marker.openPopup();
    }, 50);
  };

  // Filter Dictionary by Search AND Region
  const filteredDictionary = useMemo(() => {
    return areaCodes.filter((item) => {
      const matchesSearch =
        item.place.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.code.replace(/\s+/g, "").includes(searchTerm);
      const matchesRegion =
        regionFilter === "All" || item.region === regionFilter;
      return matchesSearch && matchesRegion;
    });
  }, [areaCodes, searchTerm, regionFilter]);

  if (loading) return <div style={{ padding: 20 }}>Loading Data...</div>;

  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="sidebar-header">
          <h2>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "12px",
                margin: "10px 0",
              }}
            >
              <a
                href="https://www.youtube.com/@NoOneAsked_YT"
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  src={noaLogo}
                  alt="No One Asked Logo"
                  style={{
                    width: "40px",
                    height: "40px",
                    borderRadius: "50%",
                    cursor: "pointer",
                  }}
                />
              </a>
              <h1 style={{ fontSize: "24px", margin: "0" }}>
                UK Area Code Quiz
              </h1>

              {/* 1. NEW INFO BUTTON GOES HERE */}
              <button
                onClick={() => setShowInfo(!showInfo)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "14px",
                  cursor: "pointer",
                  padding: "0",
                }}
                title="How to Play"
              >
                ℹ️
              </button>
            </div>
          </h2>

          {/* 2. NEW DROPDOWN RULES BOX GOES HERE */}
          {showInfo && (
            <div
              style={{
                backgroundColor: "#f8f9fa",
                padding: "14px",
                borderRadius: "8px",
                fontSize: "13px",
                textAlign: "left",
                marginBottom: "15px",
                border: "1px solid #ddd",
                color: "#333",
              }}
            >
              <strong
                style={{
                  display: "block",
                  marginBottom: "10px",
                  fontSize: "15px",
                }}
              >
                📖 How to Play
              </strong>
              <ul
                style={{
                  paddingLeft: "0",
                  margin: "0",
                  listStyleType: "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                <li>
                  <strong>🎯 The Goal:</strong> Identify all 645 UK geographic
                  area codes to become <strong>💎 The Ofcom Oracle</strong>.
                </li>
                <li>
                  <strong>🔢 Flexible Numbers:</strong> Codes can be entered
                  with or without the leading zero (e.g., <code>0116</code> or{" "}
                  <code>116</code>).
                </li>
                <li>
                  <strong>✏️ Typo Forgiveness:</strong> In 'Code ➡️ Place' mode,
                  close spelling guesses are accepted — no need for perfection.
                </li>
                <li>
                  <strong>🗺️ Interactive Map:</strong> Click any dot on the map
                  at any time to jump directly to that location.
                </li>
                <li>
                  <strong>🤔 Stuck?:</strong> Use <strong>Skip</strong> to move
                  to a random location, or <strong>Give Up</strong> to reveal
                  the answer.
                </li>
              </ul>
            </div>
          )}

          <div className="nav-switcher">
            <button
              className={appSection === "GAME" ? "active" : ""}
              onClick={() => setAppSection("GAME")}
            >
              🎮 Play
            </button>
            <button
              className={appSection === "DICTIONARY" ? "active" : ""}
              onClick={() => setAppSection("DICTIONARY")}
            >
              📖 Dictionary
            </button>
          </div>

          {/* NEW REGION DROPDOWN */}
          <div style={{ marginBottom: "15px" }}>
            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              style={{
                width: "100%",
                padding: "10px",
                borderRadius: "6px",
                border: "2px solid #ddd",
                fontSize: "14px",
                fontWeight: "bold",
                color: "#333",
                cursor: "pointer",
              }}
            >
              <option value="All">🇬🇧 All Regions (UK)</option>
              <option value="England">🦁 England</option>
              <option value="Scotland">🦄 Scotland</option>
              <option value="Wales">🐉 Wales</option>
              <option value="NI">☘️ Northern Ireland</option>
              <option value="Crown">🏝️ Crown Dependencies</option>
            </select>
          </div>
        </div>

        {/* ================= GAME MODE UI ================= */}
        {appSection === "GAME" && (
          <div className="game-panel">
            <div className="progress-container">
              {(() => {
                const score = 50;

                // Base Rank (0 - 24)
                let rank = {
                  title: "☎️ Local Caller",
                  color: "#7f8c8d", // Slate Grey
                  shiny: false,
                };

                // The Tiers
                if (score >= 645)
                  rank = {
                    title: "💎 The Ofcom Oracle",
                    color: "linear-gradient(90deg, #00f2fe, #4facfe, #00f2fe)", // Iridescent Diamond
                    shiny: true,
                  };
                else if (score >= 550)
                  rank = {
                    title: "👑 Area Code Legend",
                    color: "linear-gradient(90deg, #F1C40F, #F39C12)", // Bright Gold
                    shiny: true,
                  };
                else if (score >= 450)
                  rank = {
                    title: "🛰️ Network Architect",
                    color: "linear-gradient(90deg, #fd79a8, #e84393)", // Vibrant Pink
                    shiny: true,
                  };
                else if (score >= 350)
                  rank = {
                    title: "🗼 Routing Specialist",
                    color: "linear-gradient(90deg, #E67E22, #D35400)", // Vibrant Orange
                    shiny: true,
                  };
                else if (score >= 250)
                  rank = {
                    title: "🎛️ Exchange Manager",
                    color: "linear-gradient(90deg, #E74C3C, #C0392B)", // Crimson Red
                    shiny: false,
                  };
                else if (score >= 150)
                  rank = {
                    title: "📡 Telecom Technician",
                    color: "linear-gradient(90deg, #9B59B6, #8E44AD)", // Deep Purple
                    shiny: false,
                  };
                else if (score >= 75)
                  rank = {
                    title: "📠 Regional Operator",
                    color: "linear-gradient(90deg, #3498DB, #2980B9)", // Cyan / Blue
                    shiny: false,
                  };
                else if (score >= 25)
                  rank = {
                    title: "🎧 Switchboard Trainee",
                    color: "linear-gradient(90deg, #2ECC71, #27AE60)", // Forest Green
                    shiny: false,
                  };

                return (
                  <>
                    <div className="rank-display">
                      <span className="rank-title">{rank.title}</span>
                    </div>
                    <div className="progress-text">
                      <span>Mastered</span>
                      <span>
                        {score} / {areaCodes.length}
                      </span>
                    </div>

                    {/* UPGRADED PROGRESS BAR WITH MILESTONES */}
                    <div
                      className="progress-bar-bg"
                      style={{ position: "relative" }}
                    >
                      <div
                        className={`progress-bar-fill ${
                          rank.shiny ? "shiny" : ""
                        }`}
                        style={{
                          width: `${(score / areaCodes.length) * 100}%`,
                          background: rank.color,
                        }}
                      ></div>

                      {/* THE MILESTONES */}
                      {[25, 75, 150, 250, 350, 450, 550].map((milestone) => (
                        <div
                          key={milestone}
                          style={{
                            position: "absolute",
                            left: `${(milestone / areaCodes.length) * 100}%`,
                            top: 0,
                            bottom: 0,
                            width: "2px",
                            backgroundColor: "rgba(0, 0, 0, 0.1)",
                            zIndex: 2,
                          }}
                        />
                      ))}
                    </div>
                  </>
                );
              })()}
              <div
                style={{
                  fontSize: "12px",
                  color: "#888",
                  marginTop: "8px",
                  textAlign: "right",
                  fontWeight: "bold",
                }}
              >
                Mistakes:{" "}
                <span style={{ color: "#e74c3c" }}>{mistakeCount}</span>
              </div>
            </div>

            <div className="mode-toggle">
              <button
                onClick={() => setMode("nameToCode")}
                className={mode === "nameToCode" ? "active-mode" : ""}
              >
                Place ➡️ Code
              </button>
              <button
                onClick={() => setMode("codeToName")}
                className={mode === "codeToName" ? "active-mode" : ""}
              >
                Code ➡️ Place
              </button>
            </div>

            <div className="quiz-box">
              {currentQuestion ? (
                <form onSubmit={handleSubmit}>
                  <div className="question-text">
                    {mode === "nameToCode"
                      ? `Code for: ${currentQuestion.place}`
                      : `Place for: ${currentQuestion.code}`}
                  </div>
                  <input
                    type="text"
                    inputMode={mode === "nameToCode" ? "numeric" : "text"}
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    autoFocus
                    placeholder={
                      mode === "nameToCode" ? "e.g. 01234" : "e.g. London"
                    }
                    ref={inputRef}
                  />
                  <button type="submit" className="check-btn">
                    Check Answer
                  </button>
                </form>
              ) : (
                <div
                  style={{
                    textAlign: "center",
                    color: "green",
                    fontWeight: "bold",
                  }}
                >
                  🏆 Map Complete!
                </div>
              )}
              <div className="feedback">{feedback}</div>
              {currentQuestion && (
                <div className="action-row">
                  <button
                    type="button"
                    onClick={() => generateQuestion()}
                    className="secondary-btn"
                  >
                    {autoNext ? "Skip" : "Random Next"}
                  </button>
                  <button
                    type="button"
                    onClick={revealAnswer}
                    className="secondary-btn"
                  >
                    Give Up & Reveal
                  </button>
                </div>
              )}
            </div>

            <div className="settings">
              {/* --- COLLAPSIBLE SETTINGS --- */}
              <details
                className="settings"
                style={{
                  background: "#f8f9fa",
                  padding: "10px",
                  borderRadius: "8px",
                  border: "1px solid #ddd",
                }}
              >
                <summary
                  style={{
                    cursor: "pointer",
                    fontWeight: "bold",
                    color: "#555",
                    outline: "none",
                  }}
                >
                  ⚙️ Advanced Settings
                </summary>

                <div style={{ marginTop: "15px" }}>
                  <label style={{ display: "block", marginBottom: "8px" }}>
                    <input
                      type="checkbox"
                      checked={autoNext}
                      onChange={() => setAutoNext(!autoNext)}
                    />{" "}
                    Auto-Next (Random Jump)
                  </label>
                  <label style={{ display: "block", marginBottom: "15px" }}>
                    <input
                      type="checkbox"
                      checked={showAllDots}
                      onChange={() => setShowAllDots(!showAllDots)}
                    />{" "}
                    Show Mastered (Green)
                  </label>

                  <div
                    style={{
                      display: "flex",
                      gap: "10px",
                      marginBottom: "15px",
                    }}
                  >
                    <button
                      onClick={exportData}
                      className="secondary-btn"
                      style={{ background: "#3498db", color: "white", flex: 1 }}
                    >
                      📤 Export
                    </button>
                    <button
                      onClick={importData}
                      className="secondary-btn"
                      style={{ background: "#9b59b6", color: "white", flex: 1 }}
                    >
                      📥 Import
                    </button>
                  </div>

                  <button
                    onClick={resetProgress}
                    className="reset-btn"
                    style={{ width: "100%" }}
                  >
                    Reset Game Progress
                  </button>
                </div>
              </details>

              {/* --- FOOTER & CREDITS --- */}
              <div
                style={{
                  marginTop: "20px",
                  fontSize: "11px",
                  color: "#999",
                  textAlign: "center",
                  lineHeight: "1.8",
                }}
              >
                Created by{" "}
                <a
                  href="https://www.youtube.com/@NoOneAsked_YT"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#999", textDecoration: "underline" }}
                >
                  No One Asked
                </a>
                <br />
                Data adapted from{" "}
                <a
                  href="https://www.doogal.co.uk/UKPhoneCodes"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#999", textDecoration: "underline" }}
                >
                  doogal.co.uk
                </a>{" "}
                (corrected)
              </div>
            </div>
          </div>
        )}

        {/* ================= DICTIONARY MODE UI ================= */}
        {appSection === "DICTIONARY" && (
          <div className="dictionary-container">
            <input
              type="text"
              placeholder="Search Place or Code..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />

            {(() => {
              let countNew = 0;
              let countLearning = 0;
              let countDone = 0;
              // Only count stats for the CURRENT filter view
              filteredDictionary.forEach((item) => {
                const status = dictStatus[item.code] || 0;
                if (status === 0) countNew++;
                else if (status === 1) countLearning++;
                else if (status === 2) countDone++;
              });
              return (
                <div className="stats-summary">
                  <span className="dot grey"></span> New ({countNew})
                  <span className="dot blue" style={{ marginLeft: 10 }}></span>{" "}
                  Learning ({countLearning})
                  <span className="dot green" style={{ marginLeft: 10 }}></span>{" "}
                  Done ({countDone})
                </div>
              );
            })()}

            <div className="dictionary-list">
              {filteredDictionary.map((item) => {
                const status = dictStatus[item.code] || 0;
                let statusColor = "#ddd";
                let statusText = "New";
                if (status === 1) {
                  statusColor = "#3498db";
                  statusText = "Learning";
                }
                if (status === 2) {
                  statusColor = "#2ecc71";
                  statusText = "Done";
                }
                const isFlashed = flashCode === item.code;

                return (
                  <div
                    key={item.code}
                    className={`dict-item ${isFlashed ? "flash-active" : ""}`}
                    ref={(el) => (dictItemRefs.current[item.code] = el)}
                    onClick={() => jumpToLocation(item)}
                    onMouseEnter={() => setHighlightCode(item.code)}
                    onMouseLeave={() => setHighlightCode(null)}
                  >
                    <div className="dict-info">
                      <div className="dict-place">{item.place}</div>
                      <div className="dict-code">{item.code}</div>
                    </div>
                    <div className="dict-actions">
                      <button
                        className="status-toggle-btn"
                        style={{
                          backgroundColor: statusColor,
                          color: status === 0 ? "#333" : "white",
                        }}
                        onClick={(e) => cycleStatus(e, item.code)}
                      >
                        {statusText}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="map-area">
        <MapContainer
          center={[54.0, -2.5]}
          zoom={6}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url={
              mode === "codeToName"
                ? "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"
                : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            }
          />

          {/* Engine for flying the camera */}
          <MapFocus
            location={currentQuestion}
            animate={shouldZoom}
            appSection={appSection}
          />

          {/* Engine for tracking zoom level to resize dots */}
          <ZoomTracker onZoom={setMapZoom} />

          {areaCodes.map((location) => {
            // HIDE DOTS THAT DO NOT MATCH THE REGION FILTER
            if (regionFilter !== "All" && location.region !== regionFilter)
              return null;

            const isGameMastered = correctList.includes(location.code);
            const isReview = reviewList.includes(location.code);
            const isGameCurrent =
              appSection === "GAME" &&
              currentQuestion &&
              currentQuestion.code === location.code;
            const dictState = dictStatus[location.code] || 0;
            const isHighlighted = highlightCode === location.code;

            let color = "#888";
            let fillColor = "#888";
            let opacity = 0.5;

            // Dynamic dot size based on zoom!
            let baseRadius = mapZoom >= 9 ? 9 : mapZoom >= 7 ? 6 : 4;
            let radius = baseRadius;
            let weight = mapZoom >= 9 ? 2 : 1;

            if (appSection === "GAME") {
              if (isGameMastered) {
                color = "#2ecc71";
                fillColor = "#2ecc71";
              } else if (isReview) {
                color = "#f39c12";
                fillColor = "#f39c12";
              }
              if (isGameCurrent) {
                color = "#e74c3c";
                fillColor = "#e74c3c";
                opacity = 1;
                radius = baseRadius + 4; // Current target is bigger
                weight = 3;
              }
              if (!showAllDots && isGameMastered) return null;
            } else {
              if (dictState === 1) {
                color = "#3498db";
                fillColor = "#3498db";
                opacity = 0.8;
              }
              if (dictState === 2) {
                color = "#2ecc71";
                fillColor = "#2ecc71";
                opacity = 0.8;
              }
              if (isHighlighted) {
                color = "#f1c40f";
                fillColor = "#f1c40f";
                opacity = 1;
                radius = baseRadius + 5; // Highlighted target is bigger
                weight = 4;
              }
            }

            return (
              <CircleMarker
                key={location.code}
                center={[location.latitude, location.longitude]}
                pathOptions={{ color, fillColor, fillOpacity: opacity, weight }}
                radius={radius}
                ref={(el) => (markerRefs.current[location.code] = el)}
                eventHandlers={{
                  click: () => {
                    if (appSection === "GAME") {
                      generateQuestion(location);
                    } else {
                      setSearchTerm("");
                      setCurrentQuestion(location);
                      setTimeout(() => {
                        const el = dictItemRefs.current[location.code];
                        if (el) {
                          el.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
                          });
                          setFlashCode(location.code);
                          setTimeout(() => setFlashCode(null), 2000);
                        }
                      }, 150);
                    }
                  },
                  mouseover: (e) => {
                    if (appSection === "DICTIONARY") e.target.openPopup();
                  },
                  mouseout: (e) => {
                    if (appSection === "DICTIONARY") e.target.closePopup();
                  },
                }}
              >
                {/* FIX: autoPan={false} prevents the map from violently jumping */}
                <Popup autoPan={false}>
                  {appSection === "DICTIONARY" || isGameMastered ? (
                    <>
                      <strong>{location.place}</strong>
                      <br />
                      {location.code}
                    </>
                  ) : mode === "nameToCode" ? (
                    <>
                      <strong>{location.place}</strong>
                      <br />
                      ???
                    </>
                  ) : (
                    <>
                      <strong>???</strong>
                      <br />
                      {location.code}
                    </>
                  )}
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}
