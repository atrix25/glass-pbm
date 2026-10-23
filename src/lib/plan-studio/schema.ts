import {z} from 'zod';
export const MODEL='employer-plan-comparison-v1';
export const goalsSchema=z.object({name:z.string().trim().min(2).max(100),lives:z.number().int().min(20).max(2000).nullable(),currentSpend:z.number().int().min(0).max(100000000000).nullable(),renewal:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v),priority:z.enum(['experience','balance','cost']),contribution:z.number().int().min(0).max(100000).nullable()}).strict();
export type Goals=z.infer<typeof goalsSchema>;
export const designSchema=z.object({id:z.enum(['experience','balance','cost']),name:z.string().min(1).max(60),generic:z.number().int().min(0).max(10000),brand:z.number().int().min(0).max(30000),nonpreferred:z.number().int().min(0).max(50000),specialtyCap:z.number().int().min(0).max(100000),deductible:z.number().int().min(0).max(500000),oop:z.number().int().min(10000).max(1000000),specialtyRestricted:z.boolean()}).strict().refine(p=>p.oop>=p.deductible,'Out-of-pocket limit must cover the deductible.');
export type Design=z.infer<typeof designSchema>;
export const DESIGNS:Design[]=[
 {id:'experience',name:'Member first',generic:500,brand:2500,nonpreferred:5000,specialtyCap:10000,deductible:0,oop:150000,specialtyRestricted:false},
 {id:'balance',name:'Balanced',generic:1000,brand:3500,nonpreferred:7000,specialtyCap:15000,deductible:10000,oop:250000,specialtyRestricted:true},
 {id:'cost',name:'Cost focused',generic:2000,brand:6000,nonpreferred:10000,specialtyCap:25000,deductible:25000,oop:350000,specialtyRestricted:true}
];
