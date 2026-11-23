/** Fictional writing samples used only when creating a new example resume. */
type Career = 'frontend' | 'java' | 'operations' | 'electronics' | 'campus';
type Stage = 'experienced' | 'graduate' | 'intern';
interface ExampleText {
  major: string;
  role: string;
  team: string;
  work: [string, string];
  project: string;
  projectNotes: [string, string];
  skill: string;
}
const careers: Record<Career, ExampleText> = {
  frontend: {
    major: '计算机科学与技术', role: '前端开发工程师', team: '应用研发组',
    work: ['使用 TypeScript 与 React 开发工单列表、批量处理和权限提示，补全加载与错误状态。', '对长列表做虚拟滚动，记录交互耗时并验证低端设备上的输入响应。'],
    project: '协作看板', projectNotes: ['实现任务拖放、筛选与 URL 状态同步，支持键盘操作。', '整理接口模拟数据，覆盖并发更新、请求失败和空结果。'],
    skill: 'TypeScript、React、CSS Grid、前端性能分析、浏览器自动化测试。',
  },
  java: {
    major: '软件工程', role: 'Java 后端开发工程师', team: '交易系统组',
    work: ['使用 Java 与 Spring Boot 实现订单查询、状态流转和超时取消，补充事务回滚测试。', '使用执行计划分析慢查询，为高频筛选建立组合索引。'],
    project: '预约管理服务', projectNotes: ['设计时段库存、预约与取消接口，用唯一约束处理重复提交。', '对并发预订和消息重试做压力测试，核对库存与订单状态。'],
    skill: 'Java、Spring Boot、MySQL、Redis、JUnit、接口设计与 SQL 调优。',
  },
  operations: {
    major: '市场营销', role: '用户运营', team: '社区运营组',
    work: ['按注册来源和活跃周期拆分用户群，整理触达节奏与活动日历。', '跟踪活动报名、到场和复访数据，分析转化下降的步骤。'],
    project: '城市阅读社群', projectNotes: ['组织每月共读与作者访谈，协调场地、志愿者和内容发布时间。', '将报名与签到记录合并，按渠道复盘参与率并调整次月选题。'],
    skill: '活动策划、内容编辑、用户访谈、Excel 数据透视表与运营分析。',
  },
  electronics: {
    major: '电子信息工程', role: '嵌入式开发工程师', team: '硬件研发组',
    work: ['开发传感器采样和串口通信模块，记录板级调试步骤与异常波形。', '协助完成温湿度变化条件下的稳定性测试，定位采样噪声来源。'],
    project: '环境监测节点', projectNotes: ['使用 STM32 定时采集环境数据，完成低功耗模式与异常重传。', '用示波器检查总线时序，并整理实测与设计参数对照表。'],
    skill: 'C、STM32、I²C、UART、电路原理图阅读、示波器与逻辑分析仪。',
  },
  campus: {
    major: '信息管理与信息系统', role: '项目助理', team: '项目协作组',
    work: ['维护调研计划和问题清单，按周更新里程碑、负责人和完成时间。', '汇总访谈记录，与项目成员复核线上流程和现场反馈。'],
    project: '校园空间预约调研', projectNotes: ['整理自习室开放时段、预约方式和学生访谈结果。', '绘制预约流程，安排同学试用并收集改进建议。'],
    skill: '需求整理、项目跟进、数据分析与跨团队沟通。',
  },
};

export function careerExample(templateId: string) {
  let career: Career;
  if (templateId.startsWith('frontend-')) career = 'frontend';
  else if (templateId.startsWith('java-') || templateId === 'product' || templateId === 'mono') career = 'java';
  else if (templateId.startsWith('operations')) career = 'operations';
  else if (templateId === 'engineering') career = 'electronics';
  else if (['organized','graduate','fresh','classic','steady'].includes(templateId)) career = 'campus';
  else return undefined;

  const stage: Stage = templateId.endsWith('-intern') ? 'intern' :
    templateId.endsWith('-campus') || career === 'campus' ? 'graduate' : 'experienced';
  return { ...careers[career], stage };
}
