// 工具声明：虾皮选品利润计算器（自定义界面，全部在本机计算，不联网）。
import { Calculator } from 'lucide-react';
import { createElement } from 'react';
import type { CustomTool } from '../kit/types';
import { Main } from './Main';

const tool: CustomTool = {
  id: 'e18',
  name: '虾皮选品利润计算器',
  tagline: '商品页一键算毛利、佣金和运费',
  icon: Calculator,
  category: '电商运营',
  type: 'data',
  mode: 'custom',
  mainLabel: '利润计算',
  params: [],
  Main: ({ ctx }) => createElement(Main, { ctx }),
};

export default tool;
