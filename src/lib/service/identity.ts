export class ServiceError extends Error { constructor(message:string,public status=400){super(message)} }
export type Access={sponsorId:string;contractId:string;actor:string;at:Date};
