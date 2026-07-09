(function () {
  "use strict";

  const OTHER_VIDEO_PLATFORM = "기타영상";

  const SECTION_SETS = {
    desktop: [
      ["dashboard", "대시보드"],
      ["members", "멤버 관리"],
      ["profiles", "프로필 관리"],
      ["schedules", "일정 관리"],
      ["videos", "영상 관리"],
      ["notices", "공지 관리"],
      ["inout", "IN&OUT 관리"],
      ["links", "링크 관리"],
      ["data-status", "데이터 상태"],
      ["settings", "설정"]
    ],
    mobile: [
      ["dashboard", "대시보드"],
      ["members", "멤버"],
      ["schedules", "일정"],
      ["videos", "영상"],
      ["notices", "공지"],
      ["inout", "IN&OUT"],
      ["links", "링크"],
      ["data-status", "데이터 상태"],
      ["settings", "설정"]
    ]
  };

  const MANAGED = {
    members: { resource: "members", label: "멤버 관리", cols: [["name", "이름"], ["race", "종족"], ["tier", "티어"], ["soop_id", "SOOP ID"]], pin: false },
    profiles: { resource: "profiles", label: "프로필 관리", cols: [["name", "이름"], ["role", "직책"], ["birth", "생년월일"], ["mbti", "MBTI"]], pin: false },
    schedules: { resource: "schedules", label: "일정 관리", cols: [["title", "제목"], ["event_date", "날짜"], ["status", "상태"]], pin: false },
    videos: { resource: "videos", label: "영상 관리", cols: [["title", "제목"], ["platform", "플랫폼"], ["member_code", "멤버"]], pin: true },
    notices: { resource: "notices", label: "공지 관리", cols: [["title", "제목"], ["station_name", "출처"], ["notice_date", "날짜"]], pin: true },
    inout: { resource: "inout", label: "IN&OUT 관리", cols: [["member_name", "이름"], ["event_type", "타입"], ["event_date", "날짜"]], pin: false },
    links: { resource: "links", label: "링크 관리", cols: [["title", "제목"], ["category", "카테고리"], ["sort_order", "순서"]], pin: false }
  };

  const MOBILE_COLS = {
    members: [["name", "이름"], ["race", "종족"], ["tier", "티어"]],
    schedules: [["title", "제목"], ["event_date", "날짜"]],
    videos: [["title", "제목"], ["platform", "플랫폼"]],
    notices: [["title", "제목"], ["station_name", "출처"]],
    inout: [["member_name", "이름"], ["event_type", "타입"], ["event_date", "날짜"]],
    links: [["title", "제목"], ["category", "카테고리"]]
  };

  const FIELDS = {
    members: [
      { name: "member_code", label: "멤버 코드", placeholder: "SOOP ID 또는 고유 코드" },
      { name: "name", label: "이름", required: true },
      { name: "race", label: "종족", type: "select", options: [["", "선택"], ["T", "T"], ["P", "P"], ["Z", "Z"]] },
      { name: "tier", label: "티어", placeholder: "God, King, Jack, Spade, 0~8, Youth" },
      { name: "role", label: "직책", placeholder: "감독, 코치, 선수" },
      { name: "soop_id", label: "SOOP ID" },
      { name: "youtube_url", label: "YouTube URL" },
      { name: "profile_image", label: "프로필 이미지 URL" },
      { name: "sort_order", label: "정렬", type: "number" },
      { name: "is_visible", label: "공개", type: "checkbox", defaultValue: true }
    ],
    profiles: [
      { name: "member_code", label: "멤버 코드", placeholder: "SOOP ID 또는 고유 코드(선택)" },
      { name: "name", label: "이름", required: true },
      { name: "role", label: "직책/타이틀", placeholder: "예: Head Coach · Jack, Coach · King" },
      { name: "image", label: "프로필 이미지 URL", wide: true },
      { name: "fallback_image", label: "대체 이미지 URL", wide: true, hint: "이미지 로드 실패 시 보여줄 주소" },
      { name: "image_pos", label: "이미지 위치", placeholder: "예: 50% 30%" },
      { name: "birth", label: "생년월일", placeholder: "예: 1990.07.04" },
      { name: "blood", label: "혈액형", placeholder: "예: B형" },
      { name: "mbti", label: "MBTI", placeholder: "예: ISFP" },
      { name: "height", label: "신장", placeholder: "예: 175cm" },
      { name: "debut", label: "방송 데뷔" },
      { name: "awards", label: "수상경력", type: "textarea", wide: true, hint: "한 줄에 하나씩 입력" },
      { name: "sort_order", label: "정렬", type: "number" },
      { name: "is_visible", label: "공개", type: "checkbox", defaultValue: true }
    ],
    schedules: [
      { name: "title", label: "제목", required: true },
      { name: "event_date", label: "날짜", type: "date" },
      { name: "start_at", label: "시작", type: "datetime-local" },
      { name: "end_at", label: "종료", type: "datetime-local" },
      { name: "status", label: "상태", type: "select", options: [["scheduled", "예정"], ["live", "진행"], ["done", "완료"], ["cancelled", "취소"]] },
      { name: "members", label: "참여 멤버", type: "csv", placeholder: "쉼표로 구분" },
      { name: "description", label: "설명", type: "textarea", wide: true },
      { name: "sort_order", label: "정렬", type: "number" },
      { name: "is_visible", label: "공개", type: "checkbox", defaultValue: true }
    ],
    videos: [
      { name: "title", label: "제목", required: true },
      { name: "platform", label: "구분", type: "select", defaultValue: OTHER_VIDEO_PLATFORM, options: [[OTHER_VIDEO_PLATFORM, OTHER_VIDEO_PLATFORM], ["팬튜브", "팬튜브"], ["보자충", "보자충"], ["YouTube", "YouTube"], ["SOOP", "SOOP"]] },
      { name: "member_code", label: "멤버/분류 코드", placeholder: "기타영상은 other 권장" },
      { name: "url", label: "영상 URL", required: true },
      { name: "published_at", label: "게시시간", type: "datetime-local", autoNow: true, readOnly: true, hint: "작성/수정 저장 시 현재 시각으로 자동 반영됩니다." },
      { name: "thumbnail", label: "썸네일 URL" },
      { name: "sort_order", label: "정렬", type: "number" },
      { name: "is_pinned", label: "고정", type: "checkbox" },
      { name: "is_visible", label: "공개", type: "checkbox", defaultValue: true }
    ],
    notices: [
      { name: "source_key", label: "원본 키", placeholder: "자동 공지 식별자" },
      { name: "title", label: "제목", required: true },
      { name: "station_name", label: "출처" },
      { name: "link", label: "링크" },
      { name: "notice_date", label: "날짜/표시시간" },
      { name: "sort_order", label: "정렬", type: "number" },
      { name: "is_pinned", label: "고정", type: "checkbox" },
      { name: "is_visible", label: "공개", type: "checkbox", defaultValue: true }
    ],
    inout: [
      { name: "member_name", label: "이름", required: true },
      { name: "event_type", label: "타입", type: "select", required: true, options: [["IN", "IN"], ["OUT", "OUT"]] },
      { name: "event_date", label: "날짜", type: "date" },
      { name: "race", label: "종족", type: "select", options: [["", "선택"], ["T", "T"], ["P", "P"], ["Z", "Z"]] },
      { name: "description", label: "설명", type: "textarea", wide: true },
      { name: "sort_order", label: "정렬", type: "number" },
      { name: "is_visible", label: "공개", type: "checkbox", defaultValue: true }
    ],
    links: [
      { name: "title", label: "제목", required: true },
      { name: "url", label: "URL", required: true },
      { name: "category", label: "카테고리" },
      { name: "note", label: "메모" },
      { name: "sort_order", label: "정렬", type: "number" },
      { name: "is_visible", label: "공개", type: "checkbox", defaultValue: true }
    ]
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function sections(mode) {
    return (SECTION_SETS[mode] || SECTION_SETS.desktop).map(([key, label]) => ({ key, label }));
  }

  function managed(mode) {
    const out = clone(MANAGED);
    if (mode === "mobile") {
      delete out.profiles;
      Object.keys(MOBILE_COLS).forEach(key => {
        if (out[key]) out[key].cols = clone(MOBILE_COLS[key]);
      });
    }
    return out;
  }

  function fields() {
    return clone(FIELDS);
  }

  function formatDateTimeLocal(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return "";
    const pad = number => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function datetimeLocalToIso(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }

  function formValue(field, row) {
    const value = row && Object.prototype.hasOwnProperty.call(row, field.name)
      ? row[field.name]
      : (field.autoNow ? new Date().toISOString() : field.defaultValue);
    if (field.type === "checkbox") return value === true || value === "true" || value === 1;
    if (field.type === "csv") return Array.isArray(value) ? value.join(", ") : String(value || "");
    if (field.type === "datetime-local" && value) return formatDateTimeLocal(value);
    return value === null || value === undefined ? "" : String(value);
  }

  function payloadFromForm(form, section) {
    const fieldList = FIELDS[section] || [];
    const data = new FormData(form);
    const payload = {};
    fieldList.forEach(field => {
      if (field.type === "checkbox") {
        payload[field.name] = Boolean(form.elements[field.name]?.checked);
        return;
      }
      const value = String(data.get(field.name) || "").trim();
      if (!value && !field.required && field.type !== "number") return;
      if (field.type === "number") {
        payload[field.name] = value ? Number(value) : 0;
        return;
      }
      if (field.type === "csv") {
        payload[field.name] = value ? value.split(",").map(item => item.trim()).filter(Boolean) : [];
        return;
      }
      payload[field.name] = field.type === "datetime-local" ? datetimeLocalToIso(value) : value;
    });
    if (section === "videos") {
      if (!payload.platform) payload.platform = OTHER_VIDEO_PLATFORM;
      payload.published_at = new Date().toISOString();
    }
    return payload;
  }

  async function api(path, options) {
    options = options || {};
    const res = await fetch("/api/admin/" + path, {
      method: options.method || "GET",
      headers: { "Content-Type": "application/json" },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store"
    });
    let data = null;
    try { data = await res.json(); } catch (error) {}
    if (!res.ok || (data && data.ok === false)) {
      const err = new Error((data && data.message) || ("api_error_" + res.status));
      err.payload = data;
      throw err;
    }
    return data ? data.data : null;
  }

  window.MonstarzAdminCore = {
    otherVideoPlatform: OTHER_VIDEO_PLATFORM,
    sections,
    managed,
    fields,
    formatDateTimeLocal,
    datetimeLocalToIso,
    formValue,
    payloadFromForm,
    api
  };
})();
