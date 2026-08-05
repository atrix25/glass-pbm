/**
 * Rendering an eligibility instruction back into ANSI X12 834.
 *
 * The segments are not stored. They are rebuilt from the columns the
 * instruction was parsed into, on the same principle as claim derivations: the
 * inputs are the record, and a saved rendering of them is a second copy that
 * can quietly disagree with the first.
 *
 * The format is 834 Benefit Enrollment and Maintenance, implementation guide
 * 005010X220A1. It is worth reading once, because the thing management
 * imagines is proprietary and hard is a text file with asterisks in it.
 *
 * Where this sponsor does something non-standard it is called out rather than
 * smoothed over: the person code rides in REF*17, the client reporting
 * category, which is not what the element is for and is exactly what employers
 * do with it.
 */

export interface X12Segment {
  /** The segment as it appears in the file. */
  text: string;
  /** What it says, for a reader who has not memorised the guide. */
  gloss: string;
}

export interface X12Source {
  controlNumber: string;
  senderId: string;
  receiverId: string;
  fileType: string;
  createdAt: Date;
  transaction: {
    maintenanceType: string;
    maintenanceReason: string | null;
    cardholderId: string;
    personCode: string;
    relationshipCode: string;
    memberName: string;
    benefitPlanId: string | null;
    coverageTier: string | null;
    effectiveDate: Date | null;
    terminationDate: Date | null;
  };
  sponsorName: string;
  dateOfBirth?: Date | null;
  gender?: string | null;
}

const MAINTENANCE_TYPE: Record<string, string> = {
  "021": "addition",
  "001": "change",
  "024": "termination",
  "025": "reinstatement",
};

const MAINTENANCE_REASON: Record<string, string> = {
  AI: "active",
  EC: "benefit selection",
  XN: "notification only",
  "07": "termination of benefits",
  "08": "termination of employment",
  "25": "change in identifying data elements",
};

const RELATIONSHIP: Record<string, string> = {
  "18": "self",
  "01": "spouse",
  "19": "child",
};

function d8(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function hhmm(date: Date): string {
  return date.toISOString().slice(11, 16).replace(":", "");
}

function pad(value: string, width: number): string {
  return value.slice(0, width).padEnd(width, " ");
}

/** The interchange envelope, which every file carries whatever is inside it. */
function envelope(src: X12Source): X12Segment[] {
  const created = src.createdAt;
  return [
    {
      text:
        `ISA*00*${pad("", 10)}*00*${pad("", 10)}*ZZ*${pad(src.senderId, 15)}` +
        `*ZZ*${pad(src.receiverId, 15)}*${d8(created).slice(2)}*${hhmm(created)}` +
        `*^*00501*${src.controlNumber}*0*P*:~`,
      gloss:
        "Interchange header. Sender, receiver, the date and time the file was cut, and the control number both sides will quote at each other when something is wrong.",
    },
    {
      text: `GS*BE*${src.senderId}*${src.receiverId}*${d8(created)}*${hhmm(created)}*${src.controlNumber.slice(-6)}*X*005010X220A1~`,
      gloss:
        "Functional group. BE is benefit enrollment, and 005010X220A1 names the implementation guide this file claims to follow.",
    },
    {
      text: "ST*834*0001*005010X220A1~",
      gloss: "Start of the transaction set.",
    },
    {
      text: `BGN*00*${src.controlNumber}*${d8(created)}*${hhmm(created)}*ET***${src.fileType === "Change" ? "2" : "4"}~`,
      gloss:
        src.fileType === "Change"
          ? "Beginning segment. Action code 2 is a change file: it carries only what moved since the last one."
          : "Beginning segment. Action code 4 is a verify file: it restates the whole population so both sides can find what has drifted.",
    },
    {
      text: "REF*38*ETG0013~",
      gloss: "The contract this membership is enrolled under.",
    },
    {
      text: `N1*P5*${src.sponsorName.toUpperCase()}~`,
      gloss: "The plan sponsor, who decides who is covered.",
    },
    { text: "N1*IN*GLASS RX~", gloss: "The processor, who is being told." },
  ];
}

/** The member level detail: one person, one instruction. */
function memberDetail(src: X12Source): X12Segment[] {
  const t = src.transaction;
  const isSubscriber = t.relationshipCode === "18";
  const out: X12Segment[] = [];

  out.push({
    text: `INS*${isSubscriber ? "Y" : "N"}*${t.relationshipCode}*${t.maintenanceType}*${t.maintenanceReason ?? ""}*A***FT~`,
    gloss:
      `The instruction itself: ${MAINTENANCE_TYPE[t.maintenanceType] ?? t.maintenanceType}` +
      `${t.maintenanceReason ? `, reason ${MAINTENANCE_REASON[t.maintenanceReason] ?? t.maintenanceReason}` : ""}` +
      `, for the ${RELATIONSHIP[t.relationshipCode] ?? "member"} on the contract. ` +
      `Everything else in the loop describes who and when.`,
  });
  out.push({
    text: `REF*0F*${t.cardholderId}~`,
    gloss: "Subscriber identifier. The contract, not the person.",
  });
  out.push({
    text: `REF*17*${t.personCode}~`,
    gloss:
      "Person code. The element is the client reporting category and this is not what it is for, which is true of most 834 feeds in production.",
  });
  if (t.benefitPlanId) {
    out.push({
      text: `REF*1L*${t.benefitPlanId.toUpperCase()}~`,
      gloss: "Group number, which is how the plan design gets chosen.",
    });
  }

  const [last, first] = t.memberName.split(",").map((s) => s.trim());
  out.push({
    text: `NM1*IL*1*${(last ?? "").toUpperCase()}*${(first ?? "").toUpperCase()}****34*${t.cardholderId}~`,
    gloss: "The person's name, and the identifier they are matched on.",
  });
  if (src.dateOfBirth) {
    out.push({
      text: `DMG*D8*${d8(src.dateOfBirth)}*${src.gender ?? "U"}~`,
      gloss:
        "Date of birth and gender. Absence of a birth date is the single most common reason an instruction cannot be matched to a person.",
    });
  }
  if (t.effectiveDate) {
    out.push({
      text: `DTP*356*D8*${d8(t.effectiveDate)}~`,
      gloss: "Eligibility begins.",
    });
  }
  if (t.terminationDate) {
    out.push({
      text: `DTP*357*D8*${d8(t.terminationDate)}~`,
      gloss:
        "Eligibility ends. The gap between this date and the day the file arrived is the window in which the plan pays claims for somebody who has left.",
    });
  }

  out.push({
    text: `HD*${t.maintenanceType}**PDG*${(t.benefitPlanId ?? "UNKNOWN").toUpperCase()}*${t.coverageTier === "Family" ? "FAM" : "EMP"}~`,
    gloss:
      "The coverage itself. PDG is prescription drug, and the last element is the tier the premium was set on.",
  });
  if (t.effectiveDate) {
    out.push({
      text: `DTP*348*D8*${d8(t.effectiveDate)}~`,
      gloss: "Benefit begins, at the coverage level rather than the person.",
    });
  }
  if (t.terminationDate) {
    out.push({
      text: `DTP*349*D8*${d8(t.terminationDate)}~`,
      gloss: "Benefit ends.",
    });
  }
  return out;
}

/** Render one instruction as it arrived, envelope and all. */
export function renderX12(src: X12Source): X12Segment[] {
  const detail = memberDetail(src);
  const head = envelope(src);
  return [
    ...head,
    ...detail,
    {
      text: `SE*${head.length + detail.length + 3}*0001~`,
      gloss: "Segment count, which is the only checksum the format has.",
    },
    { text: `GE*1*${src.controlNumber.slice(-6)}~`, gloss: "End of the group." },
    { text: `IEA*1*${src.controlNumber}~`, gloss: "End of the interchange." },
  ];
}

export const MAINTENANCE_TYPE_LABEL = MAINTENANCE_TYPE;
export const MAINTENANCE_REASON_LABEL = MAINTENANCE_REASON;
