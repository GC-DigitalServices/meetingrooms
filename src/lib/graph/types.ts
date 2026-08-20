// ---------------------------------------------------------------------------
// Typed wrappers around Graph API response shapes.
// Nothing outside lib/graph/ should import raw Graph types.
// ---------------------------------------------------------------------------

export interface GraphEvent {
  id: string;
  iCalUId: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isAllDay: boolean;
  /** Absent on older reads that did not $select it. */
  type?: "singleInstance" | "occurrence" | "exception" | "seriesMaster";
  organizer: {
    emailAddress: { address: string; name: string };
  };
  attendees: Array<{
    emailAddress: { address: string; name: string };
    type: "required" | "optional" | "resource";
  }>;
  singleValueExtendedProperties?: Array<{
    id: string;
    value: string;
  }>;
}

export interface GraphCalendarViewResponse {
  value: GraphEvent[];
  "@odata.nextLink"?: string;
}

export interface GraphSubscriptionResponse {
  id: string;
  resource: string;
  changeType: string;
  notificationUrl: string;
  expirationDateTime: string;
  clientState: string;
}

export interface GraphNotificationPayload {
  value: Array<{
    subscriptionId: string;
    subscriptionExpirationDateTime: string;
    changeType: "created" | "updated" | "deleted";
    resource: string;
    resourceData: {
      id: string;
    };
    clientState: string;
  }>;
}
