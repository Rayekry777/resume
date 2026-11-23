import { SECTION_LABELS } from './model';
import type { ResumeDocument, ResumeItem, ResumeSection, SectionType, RichNode } from './model';
import { templateLayout } from './templates';
import { careerExample } from './careerExamples';
export function richText(text: string): RichNode { return { type:'doc',content:text.split('\n').map(t=>({type:'paragraph',content:t?[{type:'text',text:t}]:[]})) }; }
export function bulletText(lines: string[]): RichNode { return {type:'doc',content:[{type:'bulletList',content:lines.map(text=>({type:'listItem',content:[{type:'paragraph',content:[{type:'text',text}]}]}))}]}; }
export function newItem(values: Partial<ResumeItem> = {}): ResumeItem {return { id:crypto.randomUUID(),title:'',subtitle:'',location:'',startDate:'',endDate:'',url:'',description:richText(''),...values};}
export function newSection(type: SectionType): ResumeSection {return {id:crypto.randomUUID(),type,title:SECTION_LABELS[type],visible:true,pageBreakBefore:false,items:[newItem()]};}
export function createResume(templateId = 'neat', example = true): ResumeDocument {
 const now=Date.now();
 const d:ResumeDocument={id:crypto.randomUUID(),schemaVersion:1,title:example?'林一然的简历':'未命名简历',createdAt:now,updatedAt:now,revision:0,templateId,profile:{name:example?'林一然':'',title:example?'产品设计师':'',phone:example?'138 0000 0000':'',email:example?'hello@example.com':'',city:example?'上海':'',status:example?'3 年工作经验':'',website:'',github:''},sections:[],layout:templateLayout(templateId)};
 if(!example){d.sections=[newSection('education'),newSection('experience'),newSection('project'),newSection('skill')];return d;}
 const sample = careerExample(templateId);
 if (sample) {
   const experienced = sample.stage === 'experienced';
   const intern = sample.stage === 'intern';
   d.profile.title = intern ? sample.role + '实习生' : sample.role;
   d.profile.status = experienced ? '3 年工作经验' : intern ? '本科在读' : '应届毕业生';
   const section = (type: SectionType, item: Partial<ResumeItem>, title = SECTION_LABELS[type]): ResumeSection => ({
     ...newSection(type), title, items: [newItem(item)],
   });
   d.sections = [
     section('education', { title:'同济大学', subtitle:sample.major + ' · 本科', startDate:experienced?'2019.09':intern?'2023.09':'2022.09', endDate:experienced?'2023.06':intern?'在读':'2026.06', description:richText('大学英语六级 · 校级奖学金') }),
     section('experience', { title:experienced?'山海科技':'校企联合实践中心', subtitle:sample.team, startDate:experienced?'2023.07':'2025.06', endDate:experienced?'至今':'2025.10', description:bulletText(sample.work) }, experienced?'工作经历':'实践经历'),
     section('project', { title:sample.project, subtitle:experienced?'项目负责人':'项目成员', startDate:'2025.02', endDate:'2025.05', description:bulletText(sample.projectNotes) }),
     section('skill', { title:'专业技能与工具', description:richText(sample.skill) }),
   ];
   return d;
 }
 d.sections=[
  {...newSection('education'),items:[newItem({title:'同济大学',subtitle:'工业设计 · 本科',startDate:'2017.09',endDate:'2021.06',description:richText('GPA 3.8 / 4.0 · 优秀毕业生 · 大学英语六级')})]},
  {...newSection('experience'),items:[newItem({title:'山海科技',subtitle:'高级产品设计师 · 用户体验中心',startDate:'2023.03',endDate:'至今',description:bulletText(['负责核心产品的全流程体验设计，覆盖需求分析、交互原型、视觉设计和上线验证。','主导设计系统建设，统一 40+ 核心组件，使设计与研发协作效率提升 30%。','结合用户访谈与行为数据，优化新用户引导流程，关键路径转化率提升 18%。'])}),newItem({title:'拾光数字',subtitle:'产品设计师',startDate:'2021.07',endDate:'2023.02',description:bulletText(['参与移动端与 Web 端产品设计，累计支持 12 个版本迭代，服务超过 10 万用户。','与产品、研发紧密协作，通过可用性测试持续优化信息架构和任务流程。'])})]},
  {...newSection('project'),items:[newItem({title:'连接计划 · 一站式协作平台',subtitle:'设计负责人',startDate:'2024.02',endDate:'2024.08',description:bulletText(['从 0 到 1 搭建面向中小团队的协作平台，独立完成调研、体验策略与核心界面设计。','将复杂任务拆解为清晰的工作流，形成可复用的产品规范，试点团队满意度达到 96%。'])})]},
  {...newSection('skill'),items:[newItem({title:'设计与协作',description:richText('熟练使用 Figma、Sketch、Adobe Creative Suite；擅长交互设计、视觉表达、设计系统与用户研究。\n具备 HTML / CSS 基础，理解前端实现，能有效推动设计落地。')})]},
  {...newSection('summary'),items:[newItem({description:richText('相信好的设计始于理解，终于细节。善于在用户需求和业务目标之间寻找平衡，愿意保持好奇，持续学习。')})]},
 ];
 return d;
}
